-- 로컬 개발 전용. 원격 프로젝트에는 절대 넣지 않는다(`--include-seed` 금지).
--
-- 운영에서는 "큼온으로 로그인"이 회원을 만든다. 로컬에서는 KMLA Online 없이 개발하려고 이메일
-- 로그인 계정과 회원 행을 직접 만든다. 로그인 화면의 "개발용 로그인"이 이 계정들을 쓴다.
-- 여러 번 실행해도 같은 결과가 되게 쓴다.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000', account.id, 'authenticated', 'authenticated',
  account.email, extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '', '', '', '', '', '', '', '',
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('10000000-0000-0000-0000-0000000000a1'::uuid, 'alice@wiki.test'),
  ('10000000-0000-0000-0000-0000000000b0'::uuid, 'bob@wiki.test'),
  ('10000000-0000-0000-0000-0000000000ad'::uuid, 'admin@wiki.test'),
  ('10000000-0000-0000-0000-0000000000e0'::uuid, 'expired@wiki.test'),
  ('10000000-0000-0000-0000-000000000000'::uuid, 'outsider@wiki.test')
) as account (id, email)
on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  account.id::text, account.id,
  jsonb_build_object('sub', account.id::text, 'email', account.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users as account
where account.email like '%@wiki.test'
on conflict (provider_id, provider) do nothing;

-- outsider는 일부러 회원 행이 없다(회원 확인 없는 계정).
insert into private.members (auth_user_id, kmla_profile_id, verified_until, is_admin, admin_handle)
values
  ('10000000-0000-0000-0000-0000000000a1', 900001, now() + interval '365 days', false, null),
  ('10000000-0000-0000-0000-0000000000b0', 900002, now() + interval '365 days', false, null),
  ('10000000-0000-0000-0000-0000000000ad', 900003, now() + interval '365 days', true, '관리자 A'),
  ('10000000-0000-0000-0000-0000000000e0', 900004, now() - interval '1 day', false, null)
on conflict (kmla_profile_id) do update set verified_until = excluded.verified_until;

-- 예시 문서. 실제 저장 경로(`save_revision`)로 넣어 가명·역링크·분류가 실제와 같게 만들어진다.
do $$
declare
  v_pages constant jsonb := jsonb_build_array(
    jsonb_build_array('위키:대문', E'큼온 위키에 온 것을 환영합니다. 학교 안에 있어야만 알 수 있는 것을 함께 적습니다.\n\n## 둘러보기\n\n- [[귀가]]\n- [[신성]]\n- [[민사고 용어]]\n\n## 처음이라면\n\n[[위키:편집 도움말]]을 읽어 보세요. 틀려도 괜찮습니다. 다른 사람이 고칩니다.'),
    jsonb_build_array('위키:편집 도움말', E'## 글자\n\n| 하고 싶은 것 | 이렇게 씁니다 |\n| --- | --- |\n| 굵게 | `**글자**` |\n| 밑줄 | `__글자__` |\n| 취소선 | `~~글자~~` |\n| 다른 문서로 링크 | `[[문서 이름]]` 또는 `[[문서 이름|보여 줄 글자]]` |\n| 각주 | 문장 뒤에 `[^1]`, 문서 끝에 `[^1]: 내용` |\n\n## 문단\n\n`## 제목`으로 문단을 나눕니다. 제목이 셋 이상이면 목차가 생깁니다.\n\n:::접기 예시 보기\n접어 둔 내용입니다.\n:::'),
    jsonb_build_array('틀:오래된 정보', E'> ⚠️ 이 문서의 내용은 바뀌었을 수 있습니다. 아는 사람이 고쳐 주세요.'),
    jsonb_build_array('귀가', E'집에 가는 방법을 모은 문서입니다.[^1]\n\n## 종류\n\n- [[귀가/정기 귀가]]\n- [[외출·외박]]\n\n## 신청\n\n신청은 담임 선생님께 합니다.\n\n## 주의\n\n[[신성]] 시간과 겹치지 않게 합니다.\n\n[^1]: 2026년 기준.\n\n[[분류:생활]]'),
    jsonb_build_array('귀가/정기 귀가', E'{{틀:오래된 정보}}\n\n귀가주에 집에 가는 것. __금요일__ 수업이 끝나면 출발합니다.\n\n[[분류:생활]]'),
    jsonb_build_array('신성', E'**신성**은 저녁 자습 전 시간이다.\n\n[[분류:생활]]'),
    jsonb_build_array('분류:생활', E'학교생활에 관한 문서.'),
    jsonb_build_array('중베', E'#넘겨주기 [[덕고관/엘리베이터]]')
  );
  v_page jsonb;
begin
  if exists (select 1 from public.pages) then
    return;
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-0000-0000-0000000000a1","role":"authenticated"}',
    true
  );
  for v_page in select * from jsonb_array_elements(v_pages) loop
    perform public.save_revision(v_page ->> 0, null, v_page ->> 1, '예시 문서');
  end loop;
  perform set_config('request.jwt.claims', '', true);
end;
$$;
