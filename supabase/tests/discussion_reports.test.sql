-- 토론 글 신고: 신고, 관리자 목록·닫기, 글 숨기기·토론 지우기·문서 삭제가 신고를 닫음, 판 신고와 함께 세기.
begin;
\ir helpers.inc
select * from no_plan();

select login(:bob);
select page_id as p1, revision_id as r1 from public.save_revision('신고 토론 문서', null, wiki('첫 판')) \gset
select public.open_discussion(:p1, '첫 토론', '첫 글') as d1 \gset
select public.add_discussion_post(:d1, '둘째 글') as post2 \gset
select public.open_discussion(:p1, '둘째 토론', '다른 토론의 첫 글') as d2 \gset
select public.open_discussion(:p1, '거둘 토론', '거둘 토론의 첫 글') as d3 \gset
select public.add_discussion_post(:d3, '거둘 글') as post4 \gset
select public.withdraw_discussion_post(:post4);
select page_id as p2 from public.save_revision('지울 문서', null, wiki('판')) \gset
select public.open_discussion(:p2, '지울 문서 토론', '지울 문서의 첫 글') as d4 \gset
select throws_ok(format($$select public.report_discussion_post(%s, 'abuse')$$, :post2), 'WK006', null,
  'a member cannot report their own post');
select logout();
select id as post5 from private.discussion_posts where discussion_id = :d3 and kind = 'open' \gset
select id as post6 from private.discussion_posts where discussion_id = :d4 and kind = 'open' \gset
select id as post1 from private.discussion_posts where discussion_id = :d1 and kind = 'open' \gset
select id as post3 from private.discussion_posts where discussion_id = :d2 and kind = 'open' \gset

-- ── 신고 ─────────────────────────────────────────────────────────────────────
select login(:alice);
select lives_ok(format($$select public.report_discussion_post(%s, 'abuse')$$, :post2),
  'a member can report a discussion post');
select throws_ok(format($$select public.report_discussion_post(%s, 'privacy')$$, :post2), 'WK011', null,
  'the same member cannot report the same post again while it is open');
select throws_ok(format($$select public.report_discussion_post(%s, 'other', ' ')$$, :post1), 'WK014', null,
  'other needs a note');
select throws_ok(format($$select public.report_discussion_post(%s, 'spam')$$, :post1), '22023', null,
  'the category must be known');
select throws_ok($$select public.report_discussion_post(999999, 'abuse')$$, 'WK006', null,
  'a missing post cannot be reported');
select throws_ok(format($$select public.report_discussion_post(%s, 'abuse')$$, :post4), 'WK006', null,
  'a withdrawn post cannot be reported');
select throws_ok($$select * from public.list_open_post_reports()$$, '42501', null,
  'a member cannot list post reports');
select throws_ok(format($$select public.resolve_post_reports(%s, 'handled')$$, :post2), '42501', null,
  'a member cannot close post reports');
select lives_ok(format($$select public.report_revision(%s, 'vandalism')$$, :r1),
  'a revision report still works next to post reports');
select logout();

select is(
  (select num_nonnulls(revision_id, post_id) from private.reports where post_id = :post2), 1,
  'a post report has no revision');

select login(:admin);
select lives_ok(format($$select public.report_discussion_post(%s, 'abuse', '같은 글')$$, :post2),
  'another member can report the same post');
select logout();

-- ── 관리자 목록과 닫기 ────────────────────────────────────────────────────────
select login(:admin);
select is(public.count_open_reports(), 2, 'the open count adds reported revisions and reported posts');
select is((select count(*)::integer from public.list_open_post_reports()), 1, 'reports are grouped by post');
select is(
  (select jsonb_array_length(reports) from public.list_open_post_reports() where post_id = :post2), 2,
  'the group holds both reports');
select is(
  (select body from public.list_open_post_reports() where post_id = :post2), '둘째 글',
  'the admin sees the post body');
select is((select count(*)::integer from public.list_open_reports()), 1,
  'the revision list does not show post reports');
select is(public.resolve_post_reports(:post2, 'dismissed'), 2, 'an admin dismisses the reports on a post');
select throws_ok(format($$select public.resolve_post_reports(%s, 'handled')$$, :post2), 'WK011', null,
  'closing a post without open reports fails');
select logout();

select login(:alice);
select throws_ok(format($$select public.report_discussion_post(%s, 'abuse')$$, :post2), 'WK011', null,
  'a member cannot report a post again after it was dismissed');
select logout();

-- ── 숨기기와 지우기가 신고를 닫는다 ───────────────────────────────────────────
select login(:alice);
select public.report_discussion_post(:post1, 'privacy');
select public.report_discussion_post(:post3, 'privacy');
select logout();

select login(:admin);
select public.set_discussion_post_hidden(:post1, true, '개인정보');
select public.set_discussion_deleted(:d2, true, '토론 지움');
select logout();
select is(
  (select resolution from private.reports where post_id = :post1), 'handled',
  'hiding a post closes its reports');
select is(
  (select resolution from private.reports where post_id = :post3), 'handled',
  'deleting a discussion closes the reports on its posts');

select login(:alice);
select throws_ok(format($$select public.report_discussion_post(%s, 'abuse')$$, :post1), 'WK006', null,
  'a hidden post cannot be reported');
select throws_ok(format($$select public.report_discussion_post(%s, 'abuse')$$, :post3), 'WK006', null,
  'a post in a deleted discussion cannot be reported');
select logout();

select login(:bob);
select public.withdraw_discussion(:d3);
select logout();
select login(:alice);
select throws_ok(format($$select public.report_discussion_post(%s, 'abuse')$$, :post5), 'WK006', null,
  'a post in a withdrawn discussion cannot be reported');
select logout();

-- ── 횟수 제한은 판과 글을 함께 센다 ──────────────────────────────────────────
select login(:bob);
select public.add_discussion_post(:d1, '글 ' || n) from generate_series(1, 9) as n;
select logout();
-- alice가 한도까지 남은 수만큼 새 글을 골라 두고, 마지막 글 하나는 남긴다.
select array_agg(id order by id) as fill
from (
  select id from private.discussion_posts
  where discussion_id = :d1 and kind = 'post' and id > :post2
  order by id
  limit 10 - (
    select count(*) from private.reports as report
    join private.members as member on member.id = report.reporter_member_id
    where member.kmla_profile_id = 9001
  )
) as picked \gset
select id as extra from private.discussion_posts
where discussion_id = :d1 and id > :post2 and id <> all (:'fill'::bigint[])
order by id desc limit 1 \gset

select login(:alice);
select is(
  (select count(*)::integer from unnest(:'fill'::bigint[]) as id, public.report_discussion_post(id, 'abuse')),
  cardinality(:'fill'::bigint[]), 'a member can report up to the limit');
select throws_ok(format($$select public.report_discussion_post(%s, 'abuse')$$, :extra),
  'WK019', null, 'reports of revisions and posts share the hourly limit');
select logout();

-- ── 문서 삭제가 신고를 닫는다 ────────────────────────────────────────────────
-- 위에서 alice는 한도를 다 썼으므로 admin이 신고한다.
select login(:admin);
select public.report_discussion_post(:post6, 'privacy');
select public.delete_page(:p2, '문서 지움');
select logout();
select is(
  (select resolution from private.reports where post_id = :post6), 'handled',
  'deleting a page closes the reports on its discussion posts');

select * from finish();
rollback;
