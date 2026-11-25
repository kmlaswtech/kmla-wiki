-- 관리자 해제를 7일 안에 되돌린다(restore_revoked_admin). 해제 대상은 private.admin_revocations에 남는다.
--
-- 오류 코드
--   WK020  되돌릴 수 있는 기간이 지남

SET local check_function_bodies = off;

ALTER TABLE "public"."admin_log"
  DROP CONSTRAINT "admin_log_action";

CREATE TABLE "private"."admin_revocations" (
  "admin_log_id" bigint                   NOT NULL,
  "member_id"    bigint                   NOT NULL,
  "admin_handle" text                     NOT NULL,
  "revoked_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "restored_at"  timestamp with time zone,
  CONSTRAINT "admin_revocations_pkey" PRIMARY KEY (admin_log_id)
);

ALTER TABLE "private"."admin_revocations"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.next_admin_handle()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  -- 관리자 A, B, … Z, 그다음은 번호. 되돌릴 수 있는 해제의 이름은 비워 둔다. 되돌리면 같은
  -- 이름으로 돌아온다.
  select coalesce(
    (
      select '관리자 ' || chr(code)
      from generate_series(ascii('A'), ascii('Z')) as code
      where not exists (
        select 1 from private.members where admin_handle = '관리자 ' || chr(code)
      )
        and not exists (
          select 1 from private.admin_revocations as revocation
          where revocation.admin_handle = '관리자 ' || chr(code)
            and revocation.restored_at is null
            and revocation.revoked_at > now() - private.revocation_restore_window()
            and not exists (
              select 1 from private.members as revoked
              where revoked.id = revocation.member_id and revoked.is_admin
            )
        )
      order by code
      limit 1
    ),
    '관리자 ' || (select count(*) + 1 from private.members where is_admin)
  );
$function$;

CREATE OR REPLACE FUNCTION private.revocation_restore_window()
  RETURNS interval
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select interval '7 days';
$function$;

CREATE OR REPLACE FUNCTION public.grant_admin (
  p_revision_id bigint,
  p_reason      text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_reason text;
  v_target record;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);

  select * into v_target from private.revision_target(p_revision_id);
  if v_target.member_id is null then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;
  if exists (select 1 from private.members where id = v_target.member_id and is_admin) then
    raise exception 'already an admin' using errcode = 'WK011';
  end if;
  if private.member_is_banned(v_target.member_id) then
    raise exception 'target is banned' using errcode = 'WK002';
  end if;

  -- 해제 되돌리기와 같은 잠금이다. 동시에 같은 이름을 고르지 않게 한다.
  perform 1 from private.members where is_admin for update;
  update private.members
     set is_admin = true, admin_handle = private.next_admin_handle()
   where id = v_target.member_id;

  -- 누구를 지정했는지는 공개하지 않는다. 가명과 문서를 남기면 그 가명이 관리자라는 것이 드러난다.
  perform private.log_admin_action('grant_admin', v_reason);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_restorable_revocations()
  RETURNS TABLE (
    admin_log_id     bigint,
    admin_handle     text,
    reason           text,
    revoked_at       timestamp with time zone,
    restorable_until timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_admin();
  return query
  select revocation.admin_log_id, revocation.admin_handle, log.reason, revocation.revoked_at,
         revocation.revoked_at + private.revocation_restore_window()
  from private.admin_revocations as revocation
  join public.admin_log as log on log.id = revocation.admin_log_id
  join private.members as member on member.id = revocation.member_id
  where revocation.restored_at is null
    and revocation.revoked_at > now() - private.revocation_restore_window()
    and not member.is_admin
    and not private.member_is_banned(member.id)
  order by revocation.revoked_at desc;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_restorable_revocations"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.restore_revoked_admin (
  p_admin_log_id bigint,
  p_reason       text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_reason text;
  v_revocation private.admin_revocations;
  v_handle text;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);

  select * into v_revocation from private.admin_revocations
  where admin_log_id = p_admin_log_id
  for update;
  if v_revocation.admin_log_id is null then
    raise exception 'revocation not found' using errcode = 'WK006';
  end if;
  if v_revocation.restored_at is not null
     or exists (select 1 from private.members where id = v_revocation.member_id and is_admin) then
    raise exception 'already restored' using errcode = 'WK011';
  end if;
  if v_revocation.revoked_at <= now() - private.revocation_restore_window() then
    raise exception 'too late to restore' using errcode = 'WK020';
  end if;
  if private.member_is_banned(v_revocation.member_id) then
    raise exception 'target is banned' using errcode = 'WK002';
  end if;

  -- 이름은 기간 동안 비워 두었다. 그래도 겹치면(최초 지정처럼 SQL로 직접 바꾼 경우) 새 이름을 준다.
  perform 1 from private.members where is_admin for update;
  v_handle := case
    when exists (select 1 from private.members where admin_handle = v_revocation.admin_handle)
      then private.next_admin_handle()
    else v_revocation.admin_handle
  end;

  update private.members
     set is_admin = true, admin_handle = v_handle
   where id = v_revocation.member_id;
  update private.admin_revocations
     set restored_at = now()
   where admin_log_id = p_admin_log_id;

  -- 지정과 같이 대상은 공개하지 않는다. 어느 해제를 되돌렸는지만 남긴다.
  perform private.log_admin_action(
    'restore_admin', v_reason, null, null, null, '기록 #' || p_admin_log_id
  );
  return v_handle;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."restore_revoked_admin"(bigint, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.revoke_admin (
  p_admin_handle text,
  p_reason       text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_reason text;
  v_member_id bigint;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);

  -- 동시에 서로를 해제해 관리자가 0명이 되는 일을 막는다.
  perform 1 from private.members where is_admin for update;

  select id into v_member_id from private.members
  where admin_handle = p_admin_handle and is_admin;
  if v_member_id is null then
    raise exception 'admin not found' using errcode = 'WK006';
  end if;
  if (select count(*) from private.members where is_admin) <= 1 then
    raise exception 'cannot revoke the last admin' using errcode = 'WK013';
  end if;

  update private.members set is_admin = false, admin_handle = null where id = v_member_id;
  -- 잘못 해제했을 때 되돌릴 수 있게 대상을 남긴다. 공개 기록에는 여전히 대상이 없다.
  insert into private.admin_revocations (admin_log_id, member_id, admin_handle)
  values (private.log_admin_action('revoke_admin', v_reason), v_member_id, p_admin_handle);
end;
$function$;

ALTER TABLE "private"."admin_revocations"
  ADD CONSTRAINT "admin_revocations_admin_log_id_fkey" FOREIGN KEY (admin_log_id) REFERENCES public.admin_log(id) ON DELETE CASCADE;

ALTER TABLE "private"."admin_revocations"
  ADD CONSTRAINT "admin_revocations_member_id_fkey" FOREIGN KEY (member_id) REFERENCES private.members(id) ON DELETE CASCADE;

ALTER TABLE "public"."admin_log"
  ADD CONSTRAINT "admin_log_action"
    CHECK
    ((action = ANY (ARRAY['ban'::text, 'lift_ban'::text, 'grant_admin'::text, 'revoke_admin'::text, 'protect'::text, 'unprotect'::text, 'delete_page'::text, 'restore_page'::text,
    'hide_revision'::text, 'unhide_revision'::text, 'view_author_edits'::text, 'change_ban'::text, 'bulk_revert'::text, 'restore_admin'::text])));

REVOKE ALL ON FUNCTION "private"."revocation_restore_window"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_restorable_revocations"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_restorable_revocations"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_restorable_revocations"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_restorable_revocations"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."restore_revoked_admin"(bigint, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."restore_revoked_admin"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."restore_revoked_admin"(bigint, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."restore_revoked_admin"(bigint, text) TO "service_role";
