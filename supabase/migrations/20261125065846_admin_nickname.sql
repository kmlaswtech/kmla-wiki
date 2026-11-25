-- 관리자 전용 별명(set_admin_nickname). 관리자 목록(list_admins)에만 보이고 공개 기록에는 남기지 않는다.
-- 해제(revoke_admin)하면 지운다. 형식은 private.is_valid_admin_nickname이 정한다. 새 오류 코드 WK021(별명 형식이 틀림).

SET local check_function_bodies = off;

DROP FUNCTION "public"."list_admins"();

ALTER TABLE "private"."members"
  ADD COLUMN "admin_nickname" text;

CREATE OR REPLACE FUNCTION private.is_valid_admin_nickname (
  p_nickname text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select p_nickname = btrim(p_nickname)
     and char_length(p_nickname) between 1 and 20
     and p_nickname !~ '[[:cntrl:]\u00A0\u00AD\u115F\u1160\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0]'
     and p_nickname !~ '^관리자';
$function$;

CREATE OR REPLACE FUNCTION public.list_admins()
  RETURNS TABLE (
    admin_handle   text,
    admin_nickname text,
    is_me          boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_admin();
  return query
  select member.admin_handle, member.admin_nickname, member.id = private.current_member_id()
  from private.members as member
  where member.is_admin
  order by member.admin_handle;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_admins"() FROM PUBLIC, "anon";

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

  update private.members
     set is_admin = false, admin_handle = null, admin_nickname = null
   where id = v_member_id;
  -- 잘못 해제했을 때 되돌릴 수 있게 대상을 남긴다. 공개 기록에는 여전히 대상이 없다.
  insert into private.admin_revocations (admin_log_id, member_id, admin_handle)
  values (private.log_admin_action('revoke_admin', v_reason), v_member_id, p_admin_handle);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_admin_nickname (
  p_nickname text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_admin();
  v_nickname text := nullif(btrim(p_nickname), '');
begin
  if not private.is_valid_admin_nickname(v_nickname) then
    raise exception 'invalid admin nickname' using errcode = 'WK021';
  end if;

  -- 동시에 해제되었으면 아무것도 바꾸지 않는다(해제가 별명을 지운다).
  update private.members set admin_nickname = v_nickname
  where id = v_member_id and is_admin;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_admin_nickname"(text) FROM PUBLIC, "anon";

REVOKE ALL ON FUNCTION "private"."is_valid_admin_nickname"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_admins"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_admins"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_admins"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_admins"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_admin_nickname"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_admin_nickname"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_admin_nickname"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_admin_nickname"(text) TO "service_role";

ALTER TABLE "private"."members"
  ADD CONSTRAINT "members_admin_nickname_shape" CHECK (((admin_nickname IS NULL) OR (is_admin AND private.is_valid_admin_nickname(admin_nickname))));
