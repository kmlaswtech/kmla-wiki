-- 테스트 파일이 `\ir 000_helpers.sql`로 불러 쓰는 공통 준비물이다. 자체로는 테스트가 아니다.
--
-- 계정 다섯 개를 만든다. 실제 운영에서는 `kmla-verify`가 members를 채우지만, 권한 함수는
-- `verified_until`만 보므로 누가 채웠는지는 테스트와 무관하다.
create extension if not exists pgtap with schema extensions;

\set alice    '''00000000-0000-0000-0000-0000000000a1'''
\set bob      '''00000000-0000-0000-0000-0000000000b0'''
\set admin    '''00000000-0000-0000-0000-0000000000ad'''
\set expired  '''00000000-0000-0000-0000-0000000000e0'''
\set outsider '''00000000-0000-0000-0000-000000000000'''

-- 로컬 DB에는 seed 문서와 계정이 들어 있을 수 있다. 테스트는 빈 상태에서 시작한다. 각 테스트
-- 파일은 트랜잭션 안에서 돌고 끝에 rollback하므로 seed는 그대로 남는다.
truncate public.pages, public.admin_log, public.ban_log cascade;
delete from private.members;
delete from auth.users where email like '%@wiki.test';

insert into auth.users (id, email)
values
  (:alice, 'alice@wiki.test'),
  (:bob, 'bob@wiki.test'),
  (:admin, 'admin@wiki.test'),
  (:expired, 'expired@wiki.test'),
  (:outsider, 'outsider@wiki.test');

insert into private.members (auth_user_id, kmla_profile_id, verified_until, is_admin, admin_handle)
values
  (:alice, 9001, now() + interval '7 days', false, null),
  (:bob, 9002, now() + interval '7 days', false, null),
  (:admin, 9003, now() + interval '7 days', true, '관리자 A'),
  (:expired, 9004, now() - interval '1 day', false, null);

-- 로그인 흉내. PostgREST가 하는 것과 같게 역할과 JWT 클레임을 건다.
-- 사용: `select login(:alice);` … `select logout();`
create function public.login(p_user_id uuid) returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
  select set_config('role', 'authenticated', true);
$$;

create function public.logout() returns void
language sql
as $$
  select set_config('role', 'postgres', true);
  select set_config('request.jwt.claims', '', true);
$$;

grant execute on function public.login(uuid), public.logout() to authenticated;
