-- 선언적 스키마 정본. 이 파일을 먼저 고치고 `pnpm db:diff <이름>`으로 migration 초안을 만든 뒤 검토한다.
--
-- 스키마, 확장, 기본 권한, 회원과 KMLA 회원 확인, 읽기·편집 권한 도우미, keepalive.

SET check_function_bodies = false;

CREATE SCHEMA "private";

GRANT USAGE ON SCHEMA "private" TO "authenticated", "service_role";

COMMENT ON SCHEMA "public" IS 'standard public schema';

REVOKE ALL ON SCHEMA "public" FROM PUBLIC;

GRANT USAGE ON SCHEMA "public" TO PUBLIC;

REVOKE ALL ON SCHEMA "public" FROM "anon";

GRANT USAGE ON SCHEMA "public" TO "anon";

REVOKE ALL ON SCHEMA "public" FROM "authenticated";

GRANT USAGE ON SCHEMA "public" TO "authenticated";

REVOKE ALL ON SCHEMA "public" FROM "pg_database_owner";

GRANT CREATE, USAGE ON SCHEMA "public" TO "pg_database_owner";

REVOKE ALL ON SCHEMA "public" FROM "postgres";

GRANT USAGE ON SCHEMA "public" TO "postgres";

REVOKE ALL ON SCHEMA "public" FROM "service_role";

GRANT USAGE ON SCHEMA "public" TO "service_role";

-- ── 기본 권한 ─────────────────────────────────────────────────────────────────
-- Supabase는 public에 만든 테이블·함수의 권한을 anon·authenticated에 기본으로 준다. 위키는 그
-- 기본값을 끄고 필요한 것만 명시적으로 준다. 빠뜨린 GRANT는 "안 보임"으로 드러나지만, 빠뜨린
-- REVOKE는 조용히 열려 있기 때문이다.
--
-- 아래는 pg-delta가 적는 꼴이다. 객체를 만들기 전에 기본값을 모두 지우고, 원하는 기본값은 이 파일
-- 끝에서 다시 준다(service_role만).
--
-- `private`에는 기본 권한이 없다. 함수 EXECUTE를 PUBLIC에 주는 것은 Postgres 전역 기본값이고,
-- 스키마 단위 기본 권한은 전역 기본값에 더할 수만 있지 뺄 수는 없다. 그래서 `private` 함수마다
-- `REVOKE ALL ... FROM PUBLIC`을 따로 둔다.

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "service_role";

-- 편집 권한. 열람 권한이 있고 진행 중인 차단이 없어야 한다.
CREATE OR REPLACE FUNCTION private.can_edit()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select caller.member_id is not null
    and not private.member_is_banned(caller.member_id)
  from (select private.current_member_id() as member_id) as caller;
$function$;

GRANT EXECUTE ON FUNCTION "private"."can_edit"() TO "authenticated";

REVOKE ALL ON FUNCTION "private"."can_edit"() FROM PUBLIC;

-- 열람 권한. 차단과 무관하다.
CREATE OR REPLACE FUNCTION private.can_read()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select private.current_member_id() is not null;
$function$;

GRANT EXECUTE ON FUNCTION "private"."can_read"() TO "authenticated";

REVOKE ALL ON FUNCTION "private"."can_read"() FROM PUBLIC;

-- 회원 확인이 유효한 현재 사용자. 확인이 없거나 지났으면 NULL.
CREATE OR REPLACE FUNCTION private.current_member_id()
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select member.id
  from private.members as member
  where member.auth_user_id = (select auth.uid())
    and member.verified_until > now();
$function$;

REVOKE ALL ON FUNCTION "private"."current_member_id"() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.is_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select coalesce(
    (
      select member.is_admin
      from private.members as member
      where member.id = private.current_member_id()
    ),
    false
  );
$function$;

GRANT EXECUTE ON FUNCTION "private"."is_admin"() TO "authenticated";

REVOKE ALL ON FUNCTION "private"."is_admin"() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.member_is_banned (
  p_member_id bigint
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from private.bans as ban
    where ban.member_id = p_member_id
      and ban.lifted_at is null
      and ban.starts_at <= now()
      and (ban.ends_at is null or ban.ends_at > now())
  );
$function$;

REVOKE ALL ON FUNCTION "private"."member_is_banned"(bigint) FROM PUBLIC;

-- ── 내 상태 ──────────────────────────────────────────────────────────────────
-- 게이트와 `/me`가 쓴다. 회원 확인이 지난 사용자도 "지났다"는 사실은 알아야 하므로 `can_read()`를
-- 요구하지 않는다. 로그인한 사용자에게 항상 1행을 돌려준다.
CREATE OR REPLACE FUNCTION public.get_my_status()
  RETURNS TABLE (
    is_member      boolean,
    verified       boolean,
    verified_until timestamp with time zone,
    is_admin       boolean,
    banned         boolean,
    ban_ends_at    timestamp with time zone,
    ban_reason     text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select
    member.id is not null,
    coalesce(member.verified_until > now(), false),
    member.verified_until,
    coalesce(member.is_admin and member.verified_until > now(), false),
    ban.id is not null,
    ban.ends_at,
    ban.reason
  from (select (select auth.uid()) as uid) as caller
  left join private.members as member on member.auth_user_id = caller.uid
  left join lateral (
    select active.id, active.ends_at, active.reason
    from private.bans as active
    where active.member_id = member.id
      and active.lifted_at is null
      and active.starts_at <= now()
      and (active.ends_at is null or active.ends_at > now())
    -- 무기한 차단이 가장 길다.
    order by active.ends_at desc nulls first
    limit 1
  ) as ban on true
  where caller.uid is not null;
$function$;

GRANT EXECUTE ON FUNCTION "public"."get_my_status"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."get_my_status"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_my_status"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_my_status"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_my_status"() FROM PUBLIC, "anon";

-- 무료 Supabase 프로젝트는 한동안 요청이 없으면 일시 정지된다. `keepalive.yml` 워크플로가 매일
-- 로그인 없이(publishable key만으로) 이 함수를 불러 DB를 깨운다. 어떤 테이블도 읽지 않으므로
-- anon에게 열어도 드러나는 것이 없다. anon이 부를 수 있는 함수는 이것뿐이다.
CREATE OR REPLACE FUNCTION public.keepalive()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select true;
$function$;

GRANT EXECUTE ON FUNCTION "public"."keepalive"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."keepalive"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."keepalive"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."keepalive"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."keepalive"() FROM PUBLIC, "authenticated";

CREATE OR REPLACE FUNCTION public.record_member_verification (
  p_auth_user_id    uuid,
  p_kmla_profile_id bigint,
  p_valid_for       interval DEFAULT '14 days'::interval
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if p_auth_user_id is null or p_kmla_profile_id is null then
    raise exception 'auth user and kmla profile are required' using errcode = '22023';
  end if;

  -- 이 위키 계정이 다른 member에 붙어 있었다면 뗀다(KMLA 계정이 바뀐 경우).
  update private.members
     set auth_user_id = null, verified_until = null
   where auth_user_id = p_auth_user_id
     and kmla_profile_id <> p_kmla_profile_id;

  insert into private.members (auth_user_id, kmla_profile_id, verified_until)
  values (p_auth_user_id, p_kmla_profile_id, now() + p_valid_for)
  on conflict (kmla_profile_id) do update
    set auth_user_id = excluded.auth_user_id,
        verified_until = excluded.verified_until;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."record_member_verification"(uuid, bigint, interval) TO "service_role";

REVOKE ALL ON FUNCTION "public"."record_member_verification"(uuid, bigint, interval) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_member_verification"(uuid, bigint, interval) TO "postgres";

REVOKE ALL ON FUNCTION "public"."record_member_verification"(uuid, bigint, interval) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.revoke_member_verification (
  p_auth_user_id uuid
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  update private.members
     set verified_until = now()
   where auth_user_id = p_auth_user_id
     and verified_until > now();
$function$;

GRANT EXECUTE ON FUNCTION "public"."revoke_member_verification"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."revoke_member_verification"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."revoke_member_verification"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."revoke_member_verification"(uuid) FROM PUBLIC, "anon", "authenticated";

-- ── 회원 ─────────────────────────────────────────────────────────────────────
-- 위키 계정(auth.users)과 KMLA Online 회원을 잇는 유일한 곳이다. `verified_until`은 로그인
-- 검증(`kmla-verify`)이 채운다. 이 값이 지나면 다시 "큼온으로 로그인"을 거쳐야 한다.
CREATE TABLE "private"."members" (
  "id"              bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  -- 위키 계정이 지워져도 차단과 가명은 KMLA 회원 단위로 남아야 하므로 SET NULL이다.
  "auth_user_id"    uuid,
  "kmla_profile_id" bigint                   NOT NULL,
  "verified_until"  timestamp with time zone,
  "is_admin"        boolean                  NOT NULL DEFAULT false,
  -- 관리자끼리 서로를 구분하는 이름(`관리자 A`). 문서 가명과 연결해 보여 주지 않는다.
  "admin_handle"    text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "members_admin_handle_key" UNIQUE (admin_handle),
  CONSTRAINT "members_admin_handle_shape" CHECK ((is_admin = (admin_handle IS NOT NULL))),
  CONSTRAINT "members_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT "members_auth_user_id_key" UNIQUE (auth_user_id),
  CONSTRAINT "members_kmla_profile_id_key" UNIQUE (kmla_profile_id),
  CONSTRAINT "members_pkey" PRIMARY KEY (id)
);

ALTER TABLE "private"."members"
  ENABLE ROW LEVEL SECURITY;

-- ── 차단 ─────────────────────────────────────────────────────────────────────
-- 차단은 편집만 막는다. 열람은 그대로다. 대상은 가명이 아니라 사람(member)이라 모든 문서에 적용된다.
CREATE TABLE "private"."bans" (
  "id"                   bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "member_id"            bigint                   NOT NULL,
  "starts_at"            timestamp with time zone NOT NULL DEFAULT now(),
  -- NULL이면 무기한.
  "ends_at"              timestamp with time zone,
  "reason"               text                     NOT NULL,
  "created_by_member_id" bigint,
  "lifted_at"            timestamp with time zone,
  "lifted_by_member_id"  bigint,
  "ban_log_id"           bigint,
  CONSTRAINT "bans_ban_log_id_key" UNIQUE (ban_log_id),
  CONSTRAINT "bans_period" CHECK (((ends_at IS NULL) OR (ends_at > starts_at))),
  CONSTRAINT "bans_pkey" PRIMARY KEY (id),
  CONSTRAINT "bans_created_by_member_id_fkey" FOREIGN KEY (created_by_member_id) REFERENCES private.members(id) ON DELETE SET NULL,
  CONSTRAINT "bans_lifted_by_member_id_fkey" FOREIGN KEY (lifted_by_member_id) REFERENCES private.members(id) ON DELETE SET NULL,
  CONSTRAINT "bans_member_id_fkey" FOREIGN KEY (member_id) REFERENCES private.members(id) ON DELETE CASCADE
);

ALTER TABLE "private"."bans"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX bans_member_idx ON private.bans USING btree (member_id)
  WHERE (lifted_at IS NULL);

-- 이 뒤에 만드는 public 객체의 기본 권한. service_role에만 주고 anon·authenticated에는 주지 않는다.
-- 객체를 만든 뒤에 두어야 위 객체들의 권한이 이 기본값에 섞이지 않는다.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT, UPDATE, USAGE ON SEQUENCES TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT EXECUTE ON FUNCTIONS TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLES TO "service_role";
