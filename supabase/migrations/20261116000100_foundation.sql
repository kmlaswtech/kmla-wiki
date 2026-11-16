-- 회원과 권한의 바탕.
--
-- 원칙
--  * 브라우저가 읽는 것은 `public`뿐이고, 실제 신원과 가명의 연결은 권한을 주지 않은 `private`에 둔다.
--  * 쓰기는 전부 RPC다. 테이블에 INSERT/UPDATE/DELETE 권한을 주지 않는다.
--  * 모든 읽기 정책은 `private.can_read()`를 거친다. 로그인만 하고 KMLA Online 회원 확인을
--    받지 않은 계정은 아무것도 볼 수 없다.

-- Supabase는 public에 만든 테이블·함수의 권한을 anon·authenticated에 기본으로 준다. 위키는 그
-- 기본값을 끄고 필요한 것만 명시적으로 준다. 빠뜨린 GRANT는 "안 보임"으로 드러나지만, 빠뜨린
-- REVOKE는 조용히 열려 있기 때문이다.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

create schema if not exists private;
revoke all on schema private from public, anon;
-- RLS 정책이 `private.can_read()`를 부르려면 schema USAGE가 필요하다. 테이블 권한은 주지 않는다.
grant usage on schema private to authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke execute on functions from public;

-- ── 회원 ─────────────────────────────────────────────────────────────────────
-- 위키 계정(auth.users)과 KMLA Online 회원을 잇는 유일한 곳이다. `verified_until`은 로그인
-- 검증(`kmla-verify`)이 채운다. 이 값이 지나면 다시 "큼온으로 로그인"을 거쳐야 한다.
create table private.members (
  id bigint generated always as identity primary key,
  -- 위키 계정이 지워져도 차단과 가명은 KMLA 회원 단위로 남아야 하므로 SET NULL이다.
  auth_user_id uuid unique references auth.users (id) on delete set null,
  kmla_profile_id bigint not null unique,
  verified_until timestamptz,
  is_admin boolean not null default false,
  -- 관리자끼리 서로를 구분하는 이름(`관리자 A`). 문서 가명과 연결해 보여 주지 않는다.
  admin_handle text unique,
  created_at timestamptz not null default now(),
  constraint members_admin_handle_shape check (is_admin = (admin_handle is not null))
);

alter table private.members enable row level security;

-- ── 차단 ─────────────────────────────────────────────────────────────────────
-- 차단은 편집만 막는다. 열람은 그대로다. 대상은 가명이 아니라 사람(member)이라 모든 문서에 적용된다.
create table private.bans (
  id bigint generated always as identity primary key,
  member_id bigint not null references private.members (id) on delete cascade,
  starts_at timestamptz not null default now(),
  -- NULL이면 무기한.
  ends_at timestamptz,
  reason text not null,
  created_by_member_id bigint references private.members (id) on delete set null,
  lifted_at timestamptz,
  lifted_by_member_id bigint references private.members (id) on delete set null,
  constraint bans_period check (ends_at is null or ends_at > starts_at)
);

create index bans_member_idx on private.bans (member_id) where lifted_at is null;

alter table private.bans enable row level security;

-- ── 권한 판정 ────────────────────────────────────────────────────────────────
-- 아래 네 함수가 권한의 전부다. 정책과 RPC는 이 함수만 부른다.

-- 회원 확인이 유효한 현재 사용자. 확인이 없거나 지났으면 NULL.
create function private.current_member_id() returns bigint
language sql stable security definer set search_path = ''
as $$
  select member.id
  from private.members as member
  where member.auth_user_id = (select auth.uid())
    and member.verified_until > now();
$$;

create function private.member_is_banned(p_member_id bigint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from private.bans as ban
    where ban.member_id = p_member_id
      and ban.lifted_at is null
      and ban.starts_at <= now()
      and (ban.ends_at is null or ban.ends_at > now())
  );
$$;

-- 열람 권한. 차단과 무관하다.
create function private.can_read() returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.current_member_id() is not null;
$$;

-- 편집 권한. 열람 권한이 있고 진행 중인 차단이 없어야 한다.
create function private.can_edit() returns boolean
language sql stable security definer set search_path = ''
as $$
  select caller.member_id is not null
    and not private.member_is_banned(caller.member_id)
  from (select private.current_member_id() as member_id) as caller;
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (
      select member.is_admin
      from private.members as member
      where member.id = private.current_member_id()
    ),
    false
  );
$$;

revoke all on function private.current_member_id() from public;
revoke all on function private.member_is_banned(bigint) from public;
revoke all on function private.can_read() from public;
revoke all on function private.can_edit() from public;
revoke all on function private.is_admin() from public;
-- 정책과 invoker 함수가 부른다. `current_member_id()`와 `member_is_banned()`는 내부 번호를
-- 다루므로 주지 않는다.
grant execute on function private.can_read() to authenticated;
grant execute on function private.can_edit() to authenticated;
grant execute on function private.is_admin() to authenticated;

-- ── 내 상태 ──────────────────────────────────────────────────────────────────
-- 게이트와 `/me`가 쓴다. 회원 확인이 지난 사용자도 "지났다"는 사실은 알아야 하므로 `can_read()`를
-- 요구하지 않는다. 로그인한 사용자에게 항상 1행을 돌려준다.
create function public.get_my_status()
returns table (
  is_member boolean,
  verified boolean,
  verified_until timestamptz,
  is_admin boolean,
  banned boolean,
  ban_ends_at timestamptz,
  ban_reason text
)
language sql stable security definer set search_path = ''
as $$
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
$$;

revoke all on function public.get_my_status() from public, anon;
grant execute on function public.get_my_status() to authenticated;

-- ── 회원 확인 기록 (서버 전용) ───────────────────────────────────────────────
-- `kmla-verify` Edge Function이 service_role로 부른다. 브라우저는 부를 수 없다.
-- 같은 KMLA 회원이 새 위키 계정으로 들어오면 기존 member에 다시 잇는다(차단·가명 유지).
create function public.record_member_verification(
  p_auth_user_id uuid,
  p_kmla_profile_id bigint,
  p_valid_for interval default interval '14 days'
) returns void
language plpgsql security definer set search_path = ''
as $$
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
$$;

-- KMLA Online이 "승인 회원이 아니다"라고 답했을 때. 남은 확인 기간을 바로 끝낸다.
create function public.revoke_member_verification(p_auth_user_id uuid) returns void
language sql security definer set search_path = ''
as $$
  update private.members
     set verified_until = now()
   where auth_user_id = p_auth_user_id
     and verified_until > now();
$$;

revoke all on function public.record_member_verification(uuid, bigint, interval) from public, anon, authenticated;
revoke all on function public.revoke_member_verification(uuid) from public, anon, authenticated;
grant execute on function public.record_member_verification(uuid, bigint, interval) to service_role;
grant execute on function public.revoke_member_verification(uuid) to service_role;
