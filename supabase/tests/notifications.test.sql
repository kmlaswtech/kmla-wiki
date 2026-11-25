-- 즐겨찾기와 알림: 별표, 즐겨찾기한 문서의 편집과 새 토론, 내가 글을 쓴 토론의 새 글, 읽음 표시,
-- 거둔·숨긴·지운 것 빼기.
begin;
\ir helpers.inc
select * from no_plan();

-- bob이 문서 둘을 만들고, alice가 그 가운데 하나를 고친다.
select login(:bob);
select page_id as p1, revision_id as r1 from public.save_revision('알림 문서', null, wiki('첫 판')) \gset
select page_id as p2 from public.save_revision('bob만 쓴 문서', null, wiki('판')) \gset
select logout();
select login(:alice);
select revision_id as r2 from public.save_revision('알림 문서', :r1, wiki('둘째 판')) \gset
select logout();
-- 테스트는 한 트랜잭션이라 now()가 모두 같다. 위 편집을 한 시간 앞으로 옮긴다.
update public.revisions set created_at = now() - interval '1 hour';

select throws_ok($$select public.count_unread_notifications()$$, '42501', null,
  'a visitor without membership cannot count notifications');
select throws_ok(format($$select public.set_page_watched(%s, true)$$, :p1), '42501', null,
  'a visitor without membership cannot watch a page');
select throws_ok(format($$select public.count_page_watchers(%s)$$, :p1), '42501', null,
  'a visitor without membership cannot count the watchers');

select login(:expired);
select throws_ok($$select * from public.read_notifications()$$, '42501', null,
  'an expired member cannot read notifications');
select logout();

-- ── 즐겨찾기 ────────────────────────────────────────────────────────────────
select login(:bob);
select is(public.count_unread_notifications(), 0, 'editing a page does not make it a watched page');
select is((public.get_page_view('알림 문서') ->> 'watched')::boolean, false, 'the page view says the page is not watched');
select lives_ok(format($$select public.set_page_watched(%s, true)$$, :p1), 'a member can watch a page');
select lives_ok(format($$select public.set_page_watched(%s, true)$$, :p1), 'watching a watched page does nothing');
select is((public.get_page_view('알림 문서') ->> 'watched')::boolean, true, 'the page view says the page is watched');
select is((public.get_page_view('알림 문서') ->> 'watchers')::integer, 1, 'the page view counts the watchers');
select is((select array_agg(page_title)::text from public.list_watched_pages()), '{"알림 문서"}',
  'the watched list shows the page');
select throws_ok($$select public.set_page_watched(999999, true)$$, 'WK006', null,
  'a missing page cannot be watched');
select logout();
select is((select count(*)::integer from private.watched_pages where page_id = :p1), 1,
  'watching is stored once per member');
-- 즐겨찾기에 더한 때를 편집 뒤로 둔다. 그 앞의 편집은 알리지 않는다.
update private.watched_pages set created_at = now() - interval '30 minutes';

select login(:alice);
select is((public.get_page_view('알림 문서') ->> 'watched')::boolean, false,
  'another member does not see my watched page as watched');
select logout();

-- ── 새 토론 ──────────────────────────────────────────────────────────────────
select login(:alice);
select public.open_discussion(:p1, '알림 토론', '첫 글') as d1 \gset
select is(public.count_unread_notifications(), 0, 'a discussion on a page I did not watch does not notify me');
select logout();
select author_name as opener from private.discussion_posts where discussion_id = :d1 \gset

select login(:bob);
select is(public.count_unread_notifications(), 1, 'a new discussion on a watched page notifies me');
select is(
  (select row(reason, new_count, author_name, unread)::text from public.read_notifications()),
  row('discussion', 1, :'opener', true)::text,
  'the notification names the discussion opener and is unread');
select is(public.count_unread_notifications(), 0, 'reading the notifications marks them as seen');
select is(
  (select unread from public.read_notifications()), false,
  'a seen notification stays in the list as read');
select logout();

-- ── 즐겨찾기한 문서의 편집 ──────────────────────────────────────────────────────────
select login(:alice);
select revision_id as r3 from public.save_revision('알림 문서', :r2, wiki('셋째 판')) \gset
select revision_id as r4 from public.save_revision('알림 문서', :r3, wiki('넷째 판')) \gset
select logout();
update private.notification_marks set seen_at = now() - interval '1 minute';

select login(:bob);
select is(
  (select row(reason, page_title, new_count, from_revision_id, to_revision_id, unread)::text
    from public.read_notifications() where reason = 'edit'),
  row('edit', '알림 문서', 2, :r2, :r4, true)::text,
  'edits on a watched page notify me once with the diff ends');
select revision_id as r5 from public.save_revision('알림 문서', :r4, wiki('bob의 판')) \gset
select is((select count(*)::integer from public.read_notifications() where reason = 'edit'), 0,
  'my own edit clears the edits before it');
select logout();

select login(:alice);
select revision_id as r6 from public.save_revision('알림 문서', :r5, wiki('여섯째 판')) \gset
select revision_id as r7 from public.save_revision('알림 문서', :r6, wiki('일곱째 판')) \gset
select logout();
select login(:admin);
select public.set_revision_hidden(:r6, true, '숨김');
select logout();
select login(:bob);
select is((select new_count from public.read_notifications() where reason = 'edit'), 1,
  'a hidden revision is not counted');
select logout();
-- 뒤 테스트가 전체 수를 센다. bob이 편집해 이 알림을 없앤다.
select login(:bob);
select public.save_revision('알림 문서', :r7, wiki('bob의 둘째 판'));
select logout();

-- ── 새 글 ────────────────────────────────────────────────────────────────────
select login(:bob);
select public.add_discussion_post(:d1, 'bob의 답') as post1 \gset
select is((select count(*)::integer from public.read_notifications() where reason <> 'edit'), 0,
  'a discussion I replied to has nothing new for me');
select public.add_discussion_post(:d1, 'bob의 둘째 답') as post2 \gset
select logout();

select login(:alice);
select is(public.count_unread_notifications(), 1, 'replies in my discussion notify me once per discussion');
select is(
  (select row(reason, new_count, first_post_id)::text from public.read_notifications()),
  row('reply', 2, :post1)::text,
  'the notification counts the replies after my last post and points at the first one');
select public.add_discussion_post(:d1, 'alice의 답');
select is((select count(*)::integer from public.read_notifications()), 0,
  'my new post clears the replies before it');
select logout();

-- 제목 바꾸기 글은 새 글이 아니다. 바꾼 관리자 자신에게도, 다른 참여자에게도.
select login(:admin);
select public.add_discussion_post(:d1, '관리자의 답');
select public.rename_discussion(:d1, '바꾼 알림 토론');
select is((select count(*)::integer from public.read_notifications() where discussion_id = :d1), 0,
  'my own rename post does not notify me');
select logout();
select login(:alice);
select is((select count(*)::integer from public.read_notifications() where discussion_id = :d1), 1,
  'a rename post is not counted as a new post');
select is((select new_count from public.read_notifications() where discussion_id = :d1), 1,
  'only the real post after mine is counted');
-- 뒤 테스트가 새 글 수를 센다. alice가 답해 이 알림을 없앤다.
select public.add_discussion_post(:d1, 'alice의 둘째 답');
select logout();

select login(:bob);
select public.add_discussion_post(:d1, 'bob의 셋째 답') as post3 \gset
select public.add_discussion_post(:d1, 'bob의 넷째 답') as post4 \gset
select public.withdraw_discussion_post(:post4);
select logout();

select login(:alice);
select is((select new_count from public.read_notifications()), 1, 'a withdrawn post is not counted');
select logout();

-- 읽은 뒤에 온 글만 새 글로 센다. 테스트는 now()가 모두 같아서 본 시각을 앞으로 옮긴다.
select login(:bob);
select public.add_discussion_post(:d1, 'bob의 여섯째 답') as post6 \gset
select logout();
update private.discussion_posts set created_at = now() - interval '2 minutes'
where discussion_id = :d1 and id < :post6;
update private.notification_marks set seen_at = now() - interval '1 minute'
where member_id = (select id from private.members where kmla_profile_id = 9001);
select login(:alice);
select is(
  (select row(new_count, first_post_id, unread)::text from public.read_notifications()),
  row(1, :post6, true)::text,
  'after reading, only the posts that came later count as new');
select logout();
select login(:bob);
select public.withdraw_discussion_post(:post6);
select logout();

select login(:admin);
select public.set_discussion_post_hidden(:post3, true, '숨김');
select logout();

select login(:alice);
select is((select count(*)::integer from public.read_notifications()), 0, 'a hidden post is not counted');
select logout();

-- 내가 거둔 글은 참여로 치지 않는다.
select login(:alice);
select public.open_discussion(:p2, '거둘 참여', 'alice의 첫 글') as d5 \gset
select logout();
select login(:bob);
select public.add_discussion_post(:d5, 'bob의 답') as b5 \gset
select logout();
select login(:alice);
select public.add_discussion_post(:d5, 'alice의 답') as a5 \gset
select public.withdraw_discussion_post(:a5);
select is((select new_count from public.read_notifications() where discussion_id = :d5), 1,
  'my withdrawn post does not count as my last post');
select logout();
-- 뒤 테스트가 전체 수를 센다. 답을 거두어 이 알림을 없앤다.
select login(:bob);
select public.withdraw_discussion_post(:b5);
select logout();

-- ── 볼 수 없는 토론 ──────────────────────────────────────────────────────────
select login(:bob);
select public.add_discussion_post(:d1, 'bob의 다섯째 답');
select logout();

select login(:admin);
select public.set_discussion_deleted(:d1, true, '지움');
select logout();

select login(:alice);
select is((select count(*)::integer from public.read_notifications()), 0,
  'a deleted discussion does not notify members');
select logout();

-- 관리자도 지운 토론의 알림은 받지 않는다.
select login(:admin);
select public.set_page_watched(:p1, true);
select logout();
update private.watched_pages set created_at = now() - interval '30 minutes';
select login(:bob);
select public.open_discussion(:p1, '지울 토론', '지울 토론의 첫 글') as d3 \gset
select logout();
select login(:admin);
select is((select count(*)::integer from public.read_notifications() where reason = 'discussion'), 1,
  'an admin is notified of a new discussion on a watched page');
select public.set_discussion_deleted(:d3, true, '지움');
select is((select count(*)::integer from public.read_notifications() where reason = 'discussion'), 0,
  'a deleted discussion does not notify an admin');
select logout();

-- 첫 글을 숨긴 토론은 새 토론으로 알리지 않는다.
select login(:alice);
select public.open_discussion(:p1, '숨길 토론', '숨길 첫 글') as d4 \gset
select logout();
select id as open4 from private.discussion_posts where discussion_id = :d4 and kind = 'open' \gset
select login(:admin);
select public.set_discussion_post_hidden(:open4, true, '숨김');
select logout();
select login(:bob);
select is((select count(*)::integer from public.read_notifications() where discussion_id = :d4), 0,
  'a discussion whose opening post is hidden does not notify');
select logout();

-- ── 즐겨찾기에서 빼기 ────────────────────────────────────────────────────────────
select login(:alice);
select public.save_revision('알림 문서', (select current_revision_id from public.pages where id = :p1), wiki('여덟째 판'));
select logout();
select login(:bob);
select is((select count(*)::integer from public.read_notifications() where reason = 'edit'), 1,
  'a new edit on the watched page notifies me');
select lives_ok(format($$select public.set_page_watched(%s, false)$$, :p1), 'a member can unwatch a page');
select is((select count(*)::integer from public.read_notifications() where reason = 'edit'), 0,
  'an unwatched page does not notify');
select is((select count(*)::integer from public.list_watched_pages()), 0, 'the watched list is empty');
select logout();

-- 삭제된 문서도 즐겨찾기에 더할 수 있다. 목록에 남고 알림은 오지 않는다.
select login(:admin);
select public.delete_page(:p2, '지움');
select logout();
select login(:alice);
select lives_ok(format($$select public.set_page_watched(%s, true)$$, :p2), 'a deleted page can be watched');
select is((select page_deleted from public.list_watched_pages() where page_id = :p2), true,
  'the watched list marks a deleted page');
select logout();

-- 수와 목록은 같은 50개 안에서 센다.
-- 토론 열기에는 횟수 제한이 있어 표에 바로 넣는다. 본 시각도 지워 모두 읽지 않음으로 만든다.
insert into private.watched_pages (member_id, page_id, created_at)
select member.id, :p1, now() - interval '30 minutes' from private.members as member
where member.kmla_profile_id = 9001;
with opened as (
  insert into private.discussions (page_id, title, created_by_member_id, opened_by_member_id)
  select :p1, '토론 ' || n, member.id, member.id
  from generate_series(1, 55) as n, private.members as member
  where member.kmla_profile_id = 9002
  returning id, created_by_member_id
)
insert into private.discussion_posts (discussion_id, kind, member_id, author_name, body)
select id, 'open', created_by_member_id, '익명#000000', '글' from opened;
delete from private.notification_marks;
select login(:alice);
select is(public.count_unread_notifications(), 50, 'the unread count is capped at the 50 notifications the list shows');
select is((select count(*)::integer from public.read_notifications()), 50, 'the list shows 50 notifications');
select logout();

select * from finish();
rollback;
