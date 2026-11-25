-- 관리자 해제를 7일 안에 되돌린다(restore_revoked_admin). 해제 대상은 private.admin_revocations에 남고,
-- 되돌릴 수 있는 해제는 private.restorable_revocations view가 정한다. 관리자 지정과 되돌리기는
-- private.promote_member가 대상 회원 행을 잠근 뒤에 확인한다. 차단(ban_editor)도 그 행을 잠근다.
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
  -- 관리자 A, B, … Z, 그다음은 번호. 되돌릴 수 있는 해제의 이름은 비워 둔다.
  select coalesce(
    (
      select '관리자 ' || chr(code)
      from generate_series(ascii('A'), ascii('Z')) as code
      where not exists (
        select 1 from private.members where admin_handle = '관리자 ' || chr(code)
      )
        and not exists (
          select 1 from private.restorable_revocations as revocation
          where revocation.admin_handle = '관리자 ' || chr(code)
        )
      order by code
      limit 1
    ),
    '관리자 ' || (select count(*) + 1 from private.members where is_admin)
  );
$function$;

CREATE OR REPLACE FUNCTION private.promote_member (
  p_member_id bigint,
  p_handle    text   DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform 1 from private.members where is_admin for update;
  perform 1 from private.members where id = p_member_id for update;
  if exists (select 1 from private.members where id = p_member_id and is_admin) then
    raise exception 'already an admin' using errcode = 'WK011';
  end if;
  if private.member_is_banned(p_member_id) then
    raise exception 'target is banned' using errcode = 'WK002';
  end if;

  update private.members
     set is_admin = true,
         admin_handle = case
           when p_handle is not null
                and not exists (select 1 from private.members where admin_handle = p_handle)
             then p_handle
           else private.next_admin_handle()
         end
   where id = p_member_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.revocation_restore_window()
  RETURNS interval
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select interval '7 days';
$function$;

CREATE OR REPLACE FUNCTION public.ban_editor (
  p_revision_id bigint,
  p_length      interval,
  p_reason      text
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_admin_id bigint := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_ends_at timestamptz := private.ban_end(p_length);
  v_target record;
  v_ban_log_id bigint;
begin

  select * into v_target from private.revision_target(p_revision_id);
  if v_target.member_id is null then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;
  -- `promote_member`와 같은 행을 잠근다. 확인과 차단 사이에 관리자가 되지 않게 한다.
  perform 1 from private.members where id = v_target.member_id for update;
  if exists (select 1 from private.members where id = v_target.member_id and is_admin) then
    raise exception 'target is an admin' using errcode = 'WK010';
  end if;
  if private.member_is_banned(v_target.member_id) then
    raise exception 'already banned' using errcode = 'WK011';
  end if;

  insert into public.ban_log (pseudonym, page_title, revision_id, ends_at, reason)
  values (v_target.pseudonym, v_target.page_title, p_revision_id, v_ends_at, v_reason)
  returning id into v_ban_log_id;

  insert into private.bans (member_id, ends_at, reason, created_by_member_id, ban_log_id)
  values (v_target.member_id, v_ends_at, v_reason, v_admin_id, v_ban_log_id);

  perform private.log_admin_action(
    'ban', v_reason, v_target.page_title, p_revision_id, v_target.pseudonym,
    private.ban_end_note(v_ends_at)
  );
  return v_ban_log_id;
end;
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
  perform private.promote_member(v_target.member_id);

  -- 누구를 지정했는지는 공개하지 않는다. 가명과 문서를 남기면 그 가명이 관리자라는 것이 드러난다.
  perform private.log_admin_action('grant_admin', v_reason);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_restorable_revocations()
  RETURNS TABLE (
    admin_log_id     bigint,
    admin_handle     text,
    reason           text,
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
  select revocation.admin_log_id, revocation.admin_handle, revocation.reason,
         revocation.restorable_until
  from private.restorable_revocations as revocation
  where not private.member_is_banned(revocation.member_id)
  order by revocation.admin_log_id desc;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_restorable_revocations"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.restore_revoked_admin (
  p_admin_log_id bigint,
  p_reason       text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_reason text;
  v_revocation record;
  v_revoked_at timestamp with time zone;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);

  select member_id, admin_handle into v_revocation
  from private.restorable_revocations
  where admin_log_id = p_admin_log_id;
  if not found then
    select log.created_at into v_revoked_at
    from private.admin_revocations as revocation
    join public.admin_log as log on log.id = revocation.admin_log_id
    where revocation.admin_log_id = p_admin_log_id;
    if v_revoked_at is null then
      raise exception 'revocation not found' using errcode = 'WK006';
    elsif v_revoked_at <= now() - private.revocation_restore_window() then
      raise exception 'too late to restore' using errcode = 'WK020';
    end if;
    -- 이미 되돌렸거나, 다시 지정됐거나, 같은 사람의 더 최근 해제가 있다.
    raise exception 'already restored' using errcode = 'WK011';
  end if;

  -- 이름은 기간 동안 비워 두었다. 그래도 겹치면(SQL로 직접 바꾼 경우, 번호 이름) 새 이름을 준다.
  -- 동시에 되돌리거나 차단하면 `promote_member`가 잠근 뒤 확인해 거절한다.
  perform private.promote_member(v_revocation.member_id, v_revocation.admin_handle);
  update private.admin_revocations
     set restored_at = now()
   where admin_log_id = p_admin_log_id;

  -- 지정과 같이 대상은 공개하지 않는다. 어느 해제를 되돌렸는지만 남긴다.
  perform private.log_admin_action(
    'restore_admin', v_reason, null, null, null, '기록 #' || p_admin_log_id
  );
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

CREATE VIEW "private"."restorable_revocations" AS  SELECT DISTINCT ON (revocation.member_id) revocation.admin_log_id,
    revocation.member_id,
    revocation.admin_handle,
    log.reason,
    (log.created_at + private.revocation_restore_window()) AS restorable_until
   FROM ((private.admin_revocations revocation
     JOIN public.admin_log log ON ((log.id = revocation.admin_log_id)))
     JOIN private.members member ON ((member.id = revocation.member_id)))
  WHERE ((revocation.restored_at IS NULL) AND (log.created_at > (now() - private.revocation_restore_window())) AND (NOT member.is_admin))
  ORDER BY revocation.member_id, revocation.admin_log_id DESC;

REVOKE ALL ON FUNCTION "private"."promote_member"(bigint, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."revocation_restore_window"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_restorable_revocations"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_restorable_revocations"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_restorable_revocations"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_restorable_revocations"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."restore_revoked_admin"(bigint, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."restore_revoked_admin"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."restore_revoked_admin"(bigint, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."restore_revoked_admin"(bigint, text) TO "service_role";
