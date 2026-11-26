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
-- 이름 기록도 지운다. 회원을 지워도 이름은 남아 seed의 `관리자 A`를 다시 줄 수 없게 된다.
delete from private.admin_handles;
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
  (:admin, 9003, now() + interval '7 days', false, null),
  (:expired, 9004, now() - interval '1 day', false, null);
-- 관리자 이름은 `promote_member`만 준다(`관리자 A`).
select private.promote_member(id) from private.members where auth_user_id = :admin;

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

-- 테스트용 문서 만들기. 짧은 글로 본문 JSON을 쓴다(편집기가 내놓는 모양과 같다).
--   * 줄마다 문단 하나. 빈 줄은 건너뛴다. 아무 글도 없으면 빈 문단 하나.
--   * `[[대상]]`, `[[대상|보이는 글]]`은 위키 링크, `[[분류:이름]]`은 문서 분류.
--   * 첫 줄이 `#넘겨주기 [[대상]]`이면 넘겨주기 문서.
-- 사용: `select * from public.save_revision('신성', null, wiki('[[귀가]] 전 시간'))`
create function public.wiki(p_text text) returns jsonb
language plpgsql immutable
as $$
declare
  v_doc jsonb := '{"type":"doc","content":[]}';
  v_line text;
  v_rest text;
  v_match text[];
  v_inline jsonb;
  v_categories jsonb := '[]';
begin
  if p_text is null then
    return null;
  end if;

  v_match := regexp_match(p_text, '^\s*#넘겨주기\s+\[\[([^]|]+)\]\]');
  if v_match is not null then
    return jsonb_build_object(
      'type', 'doc', 'attrs', jsonb_build_object('redirect', v_match[1]),
      'content', '[{"type":"paragraph"}]'::jsonb
    );
  end if;

  for v_match in select regexp_matches(p_text, '\[\[(분류:[^]|]+)\]\]', 'g') loop
    v_categories := v_categories || to_jsonb(v_match[1]);
  end loop;
  p_text := regexp_replace(p_text, '\[\[분류:[^]|]+\]\]', '', 'g');

  foreach v_line in array string_to_array(p_text, E'\n') loop
    continue when btrim(v_line) = '';
    v_inline := '[]';
    v_rest := v_line;
    loop
      v_match := regexp_match(v_rest, '^(.*?)\[\[([^]|]+)(?:\|([^]]*))?\]\](.*)$');
      exit when v_match is null;
      if v_match[1] <> '' then
        v_inline := v_inline || jsonb_build_object('type', 'text', 'text', v_match[1]);
      end if;
      v_inline := v_inline || jsonb_build_object(
        'type', 'text', 'text', coalesce(v_match[3], v_match[2]),
        'marks', jsonb_build_array(jsonb_build_object(
          'type', 'wikiLink', 'attrs', jsonb_build_object('target', v_match[2], 'section', '')
        ))
      );
      v_rest := v_match[4];
    end loop;
    if v_rest <> '' then
      v_inline := v_inline || jsonb_build_object('type', 'text', 'text', v_rest);
    end if;
    v_doc := jsonb_set(v_doc, '{content}', (v_doc -> 'content') || jsonb_build_array(
      jsonb_build_object('type', 'paragraph', 'content', v_inline)
    ));
  end loop;

  if jsonb_array_length(v_doc -> 'content') = 0 then
    v_doc := jsonb_set(v_doc, '{content}', '[{"type":"paragraph"}]');
  end if;
  if jsonb_array_length(v_categories) > 0 then
    v_doc := v_doc || jsonb_build_object('attrs', jsonb_build_object('categories', v_categories));
  end if;
  return v_doc;
end;
$$;

revoke all on function public.wiki(text) from public, anon;
grant execute on function public.wiki(text) to authenticated;
