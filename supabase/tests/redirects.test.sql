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

-- ── 이동이 넘겨주기를 정리한다 ───────────────────────────────────────────────
select login(:alice);
select page_id as outing_id from public.save_revision('외출', null, wiki('외출 본문')) \gset
select page_id as alias_id from public.save_revision('외출 신청', null, wiki('#넘겨주기 [[외출]]')) \gset
select page_id as other_alias_id from public.save_revision('외박', null, wiki('#넘겨주기 [[외출]]')) \gset

-- 다른 이름을 정식 이름으로 올린다.
select lives_ok(
  $$select * from public.move_page('외출', '외출 신청')$$,
  'a page can move onto a redirect that points to it'
);
select is((select title from public.pages where id = :outing_id), '외출 신청',
  'the page takes the new title');
select is_empty(format('select 1 from public.pages where id = %s', :alias_id),
  'the redirect that held the title is removed');
select is((select redirect_target from public.pages where title = '외출'), '외출 신청',
  'the old title becomes a redirect to the new one');
select is((select redirect_target from public.pages where id = :other_alias_id), '외출 신청',
  'other redirects to the old title follow the move');
select is(
  (select revision.summary from public.pages as page
   join public.revisions as revision on revision.id = page.current_revision_id
   where page.id = :other_alias_id),
  '외출 이동에 따라 대상을 외출 신청(으)로 바꿈',
  'and say why they changed'
);
select is(public.get_page_view('외박') ->> 'title', '외출 신청',
  'so they still land on the page in one hop');

-- 넘겨주기를 남기지 않아도 넘겨주기는 따라온다.
select * from public.save_revision('점호', null, wiki('점호 본문'));
select * from public.save_revision('점호 시간', null, wiki('#넘겨주기 [[점호]]'));
select * from public.move_page('점호', '저녁 점호', false);
select is_empty($$select 1 from public.pages where title = '점호'$$,
  'without a redirect the old title is gone');
select is((select redirect_target from public.pages where title = '점호 시간'), '저녁 점호',
  'but redirects to it are still updated');

-- 넘겨주기 문서를 옮기면 남기는 넘겨주기와 따라오는 넘겨주기가 그 대상을 가리킨다.
select * from public.save_revision('야자', null, wiki('야자 본문'));
select * from public.save_revision('야간 자습', null, wiki('#넘겨주기 [[야자]]'));
select * from public.save_revision('야자습', null, wiki('#넘겨주기 [[야간 자습]]'));
select * from public.move_page('야간 자습', '야간자습');
select is((select redirect_target from public.pages where title = '야간 자습'), '야자',
  'moving a redirect leaves a redirect to its target, not a double redirect');
select is((select redirect_target from public.pages where title = '야자습'), '야자',
  'and redirects to it skip straight to the target');
select throws_ok($$select * from public.move_page('야간자습', '야자')$$, 'WK015', 'redirect to itself',
  'a redirect cannot be moved onto its own target');

-- 내용이 있던 적이 있는 넘겨주기는 지우지 않는다.
select * from public.save_revision('귀가', null, wiki('귀가 본문'));
select revision_id as homecoming_rev
from public.save_revision('귀가 신청', null, wiki('따로 쓰던 문서')) \gset
select * from public.save_revision('귀가 신청', :homecoming_rev, wiki('#넘겨주기 [[귀가]]'));
select throws_ok($$select * from public.move_page('귀가', '귀가 신청')$$, 'WK009', null,
  'a redirect with earlier content keeps its title');

-- 다른 문서로 넘겨주는 문서도 그대로다.
select throws_ok($$select * from public.move_page('귀가', '외박')$$, 'WK009', null,
  'a redirect to another page keeps its title');

-- 보호된 넘겨주기는 관리자만 치운다.
select page_id as guarded_id from public.save_revision('귀가 시간', null, wiki('#넘겨주기 [[귀가]]')) \gset
select logout();
update public.pages set protection = 'admin' where id = :guarded_id;
select login(:alice);
select throws_ok($$select * from public.move_page('귀가', '귀가 시간')$$, 'WK009', null,
  'a member cannot remove a protected redirect by moving onto it');
select logout();
select login(:admin);
select lives_ok($$select * from public.move_page('귀가', '귀가 시간')$$,
  'an admin can');
select logout();

-- ── 특수 기능: 손볼 넘겨주기 ─────────────────────────────────────────────────
select login(:alice);
select set_eq(
  $$select title, target, next from public.redirect_issues()$$,
  $$values ('기숙'::text, '긱사'::text, '기숙사'::text),
           ('고리 1', '고리 2', '고리 1'),
           ('고리 2', '고리 1', '고리 2'),
           ('옛 넘겨주기', '옛 넘겨주기 2', '기숙사'),
           ('끊김', '없는 문서', null),
           ('사라짐', '사라질 문서', null)$$,
  'broken and double redirects are listed, deleted targets count as missing'
);

select logout();
select * from finish();
rollback;
