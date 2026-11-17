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
  v_category constant jsonb := '{"categories": ["분류:생활"]}';
  v_pages constant jsonb := jsonb_build_array(
    jsonb_build_array('틀:오래된 정보', private.doc_of(jsonb_build_object(
      'type', 'blockquote',
      'content', jsonb_build_array(private.doc_para(private.doc_text_node(
        '⚠️ 이 문서의 내용은 바뀌었을 수 있습니다. 아는 사람이 고쳐 주세요.'
      )))
    ))),
    jsonb_build_array('귀가', private.doc_of(
      private.doc_para(
        private.doc_text_node('집에 가는 방법을 모은 문서입니다.'),
        jsonb_build_object('type', 'footnote', 'attrs', jsonb_build_object('note', '2026년 기준.'))
      ),
      private.doc_heading(2, '종류'),
      private.doc_list(
        private.doc_para(private.doc_link('귀가/정기 귀가')),
        private.doc_para(private.doc_link('외출·외박'))
      ),
      private.doc_heading(2, '신청'),
      private.doc_para(private.doc_text_node('신청은 담임 선생님께 합니다.')),
      private.doc_heading(2, '주의'),
      private.doc_para(
        private.doc_link('신성'),
        private.doc_text_node(' 시간과 겹치지 않게 합니다.')
      )
    ) || jsonb_build_object('attrs', v_category)),
    jsonb_build_array('귀가/정기 귀가', private.doc_of(
      jsonb_build_object('type', 'template', 'attrs', jsonb_build_object('name', '틀:오래된 정보', 'args', '[]'::jsonb)),
      private.doc_para(
        private.doc_text_node('귀가주에 집에 가는 것. '),
        private.doc_text_node('금요일', 'underline'),
        private.doc_text_node(' 수업이 끝나면 출발합니다.')
      )
    ) || jsonb_build_object('attrs', v_category)),
    jsonb_build_array('신성', private.doc_of(
      private.doc_para(
        private.doc_text_node('신성', 'bold'),
        private.doc_text_node('은 저녁 자습 전 시간이다.')
      )
    ) || jsonb_build_object('attrs', v_category)),
    jsonb_build_array('분류:생활', private.doc_of(
      private.doc_para(private.doc_text_node('학교생활에 관한 문서.'))
    )),
    jsonb_build_array('중베', private.empty_doc()
      || jsonb_build_object('attrs', jsonb_build_object('redirect', '덕고관/엘리베이터')))
  );
  v_page jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-0000-0000-0000000000a1","role":"authenticated"}',
    true
  );
  for v_page in select * from jsonb_array_elements(v_pages) loop
    -- 이미 있는 문서는 건너뛴다. 위키:대문, 위키:편집 도움말처럼 마이그레이션이 넣는 문서도 있다.
    continue when exists (
      select 1 from public.pages where title_key = lower(v_page ->> 0)
    );
    perform public.save_revision(v_page ->> 0, null, v_page -> 1, '예시 문서');
  end loop;
  perform set_config('request.jwt.claims', '', true);
end;
$$;
