-- 무료 Supabase 프로젝트는 한동안 요청이 없으면 일시 정지된다. `keepalive.yml` 워크플로가 매일
-- 로그인 없이(publishable key만으로) 이 함수를 불러 DB를 깨운다. 어떤 테이블도 읽지 않으므로
-- anon에게 열어도 드러나는 것이 없다. anon이 부를 수 있는 함수는 이것뿐이다.
create function public.keepalive() returns boolean
language sql stable security invoker set search_path = ''
as $$
  select true;
$$;

revoke all on function public.keepalive() from public, authenticated;
grant execute on function public.keepalive() to anon;
