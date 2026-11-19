-- 넘겨주기 문서: 저장 규칙, 따라가기, 넘겨주기 카드에 쓰는 대상 상태.
begin;
\ir helpers.inc
select * from no_plan();

select login(:alice);
select page_id as target_id from public.save_revision('기숙사', null, wiki('기숙사 본문')) \gset

-- ── 저장 규칙 ────────────────────────────────────────────────────────────────
select throws_ok(
  $$select * from public.save_revision('긱사', null,
    wiki('#넘겨주기 [[기숙사]]') || jsonb_build_object('content', wiki('본문') -> 'content'))$$,
  'WK015', null, 'a redirect cannot have content'
);
select throws_ok(
  $$select * from public.save_revision('긱사', null,
    jsonb_build_object('type', 'doc', 'content', '[{"type":"paragraph"}]'::jsonb,
      'attrs', jsonb_build_object('redirect', '기숙사', 'categories', '["생활"]'::jsonb)))$$,
  'WK015', null, 'a redirect cannot have categories'
);
select throws_ok(
  $$select * from public.save_revision('긱사', null, wiki('#넘겨주기 [[ 긱사 ]]'))$$,
  'WK015', null, 'a page cannot redirect to itself'
);
select throws_ok(
  $$select * from public.save_revision('긱사', null,
    jsonb_build_object('type', 'doc', 'content', '[{"type":"paragraph"}]'::jsonb,
      'attrs', jsonb_build_object('redirect', '기숙[사]')))$$,
  'WK015', null, 'a redirect target must be a usable title'
);
select lives_ok(
  $$select * from public.save_revision('긱사', null, wiki('#넘겨주기 [[기숙사]]'))$$,
  'an empty redirect saves'
);

-- 규칙 이전에 저장된 본문은 이동·되돌리기로 그대로 옮길 수 있다.
select page_id as legacy_id from public.save_revision('옛 넘겨주기', null, wiki('옛 본문')) \gset
select logout();
update public.revisions
   set body = wiki('#넘겨주기 [[기숙사]]') || jsonb_build_object('content', wiki('옛 본문') -> 'content')
 where page_id = :legacy_id;
select login(:alice);
select lives_ok(
  $$select * from public.move_page('옛 넘겨주기', '옛 넘겨주기 2')$$,
  'a legacy redirect with content can still be moved'
);

-- ── 따라가기 ─────────────────────────────────────────────────────────────────
select is(public.get_page_view('긱사') ->> 'title', '기숙사', 'one hop is followed');
select is(public.get_page_view('긱사') -> 'redirect', 'null'::jsonb,
  'the target is a normal page, so there is no redirect card');

select * from public.save_revision('기숙', null, wiki('#넘겨주기 [[긱사]]'));
select is(public.get_page_view('기숙') ->> 'title', '기숙사', 'a chain of redirects is followed');
select is(public.get_page_view('기숙') ->> 'redirected_from', '기숙',
  'and remembers the first title');

select * from public.save_revision('고리 1', null, wiki('#넘겨주기 [[고리 2]]'));
select * from public.save_revision('고리 2', null, wiki('#넘겨주기 [[고리 1]]'));
select is(public.get_page_view('고리 1') ->> 'title', '고리 2', 'a loop stops instead of spinning');
select is(public.get_page_view('고리 1') #>> '{redirect,state}', 'redirect',
  'and the stop is shown as a redirect to a redirect');

select * from public.save_revision('끊김', null, wiki('#넘겨주기 [[없는 문서]]'));
select is(public.get_page_view('끊김') ->> 'title', '끊김', 'a broken redirect shows itself');
select is(public.get_page_view('끊김') #>> '{redirect,state}', 'missing',
  'and says its target is missing');
select is(public.get_page_view('끊김') #>> '{redirect,target}', '없는 문서',
  'and names the missing target');

select is(public.get_page_view('긱사', false) #>> '{redirect,state}', 'ok',
  'opening the redirect itself reports a healthy target');
select is(public.get_page_view('기숙', false) #>> '{redirect,next}', '기숙사',
  'a redirect to a redirect says where that one goes');

-- 삭제된 대상은 없는 문서로 친다. 관리자도 따라가지 않는다.
select page_id as gone_id from public.save_revision('사라질 문서', null, wiki('본문')) \gset
select * from public.save_revision('사라짐', null, wiki('#넘겨주기 [[사라질 문서]]'));
select logout();
select login(:admin);
select public.delete_page(:gone_id, '정리');
select is(public.get_page_view('사라짐') ->> 'title', '사라짐',
  'a redirect to a deleted page is not followed');
select is(public.get_page_view('사라짐') #>> '{redirect,state}', 'missing',
  'and its target is reported as missing');

select logout();
select * from finish();
rollback;
