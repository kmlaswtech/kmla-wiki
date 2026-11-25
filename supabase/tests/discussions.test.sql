-- 토론: 열기, 글, 닫기·다시 열기(24시간 규칙), 거두기, 관리자 동작, 읽기.
begin;
\ir helpers.inc
select * from no_plan();

select login(:bob);
select page_id as p1, revision_id as r1 from public.save_revision('토론 문서', null, wiki('첫 판')) \gset
select revision_id as r2 from public.save_revision('토론 문서', :r1, wiki('둘째 판')) \gset
select page_id as p2, revision_id as q1 from public.save_revision('다른 문서', null, wiki('다른 판')) \gset
select logout();

-- ── 열기 ─────────────────────────────────────────────────────────────────────
select login(:alice);
select throws_ok(format($$select public.open_discussion(%s, ' ', '본문')$$, :p1), 'WK014', null,
  'a discussion needs a title');
select throws_ok(format($$select public.open_discussion(%s, %L, '본문')$$, :p1, repeat('가', 81)), 'WK005', null,
  'the title is at most 80 characters');
select throws_ok(format($$select public.open_discussion(%s, '제목', E' \n ')$$, :p1), 'WK014', null,
  'the first post cannot be empty');
select throws_ok(format($$select public.open_discussion(%s, '제목', %L)$$, :p1, repeat('가', 4001)), 'WK005', null,
  'a post is at most 4000 characters');
select throws_ok(format($$select public.open_discussion(%s, '제목', '본문', %s)$$, :p1, :q1), 'WK006', null,
  'a discussion can only be pinned to a revision of its own page');
select throws_ok($$select public.open_discussion(999999, '제목', '본문')$$, 'WK006', null,
  'a discussion needs an existing page');
select throws_ok(format($$select public.open_discussion(%s, '제목', '본문', null, true)$$, :p1), '42501', null,
  'a member cannot write as the admin');

select public.open_discussion(:p1, ' 첫 판 문장 ', E'첫 판의 문장이\r\n어색합니다.  ', :r1) as d1 \gset
select is((public.get_discussion(:d1) ->> 'title'), '첫 판 문장', 'the title is trimmed');
select is((public.get_discussion(:d1) #>> '{posts,0,body}'), E'첫 판의 문장이\n어색합니다.',
  'the body is trimmed and line breaks are normalized');
select is((public.get_discussion(:d1) #>> '{posts,0,kind}'), 'open', 'the first post is the opening post');
select is((public.get_discussion(:d1) #>> '{posts,0,mine}')::boolean, true, 'the opener sees the post as theirs');
select logout();

select is(
  (select author_name from private.discussion_posts where discussion_id = :d1),
  (select pseudonym from private.page_pseudonyms
    where page_id = :p1 and member_id = (select id from private.members where kmla_profile_id = 9001)),
  'the author name is the pseudonym of the author on that page');

select login(:expired);
select throws_ok(format($$select public.open_discussion(%s, '제목', '본문')$$, :p1), '42501', null,
  'a member whose verification expired cannot open a discussion');
select throws_ok(format($$select public.get_discussion(%s)$$, :d1), '42501', null,
  'a member whose verification expired cannot read a discussion');
select logout();

-- 보호 문서에도 연다.
select login(:admin);
select public.set_protection(:p2, 'admin', '보호 연습');
select logout();
select login(:bob);
select lives_ok(format($$select public.open_discussion(%s, '보호 문서 토론', '본문')$$, :p2),
  'a member can open a discussion on a protected page');
select logout();

-- ── 글과 닫기 ────────────────────────────────────────────────────────────────
select login(:bob);
select lives_ok(format($$select public.add_discussion_post(%s, '동의합니다.')$$, :d1), 'a member can reply');
select throws_ok(format($$select public.close_discussion(%s, '충분히 이야기했습니다.')$$, :d1), 'WK023', null,
  'another member cannot close within 24 hours of opening');
select is((public.get_discussion(:d1) ->> 'opened_by_me')::boolean, false, 'bob did not open this round');
select logout();

select login(:alice);
select throws_ok(format($$select public.close_discussion(%s, '짧음')$$, :d1), 'WK014', null,
  'the conclusion needs at least 10 characters');
select lives_ok(format($$select public.close_discussion(%s, '첫 판 문장을 고치기로 함.')$$, :d1),
  'the opener can close at any time');
select throws_ok(format($$select public.add_discussion_post(%s, '늦은 글')$$, :d1), 'WK022', null,
  'nobody can reply to a closed discussion');
select throws_ok(format($$select public.close_discussion(%s, '다시 닫아 봅니다, 열 글자.')$$, :d1), 'WK011', null,
  'a closed discussion cannot be closed again');
select logout();

select login(:bob);
select throws_ok(format($$select public.reopen_discussion(%s, '짧음')$$, :d1), 'WK014', null,
  'reopening needs at least 10 characters');
select lives_ok(format($$select public.reopen_discussion(%s, '아직 정리되지 않았습니다.')$$, :d1),
  'any member can reopen');
select throws_ok(format($$select public.reopen_discussion(%s, '한 번 더 열어 봅니다.')$$, :d1), 'WK011', null,
  'an open discussion cannot be reopened');
select logout();

select login(:alice);
select throws_ok(format($$select public.close_discussion(%s, '이제 정말 정리합니다.')$$, :d1), 'WK023', null,
  'after a reopen, the first opener follows the 24 hour rule too');
select logout();

select login(:admin);
select throws_ok(format($$select public.close_discussion(%s, '관리자가 이름으로 닫기.')$$, :d1), 'WK023', null,
  'an admin writing under a pseudonym follows the 24 hour rule');
select lives_ok(format($$select public.close_discussion(%s, '다툼이 커져 관리자가 닫습니다.', true)$$, :d1),
  'an admin can close early as the admin');
select logout();
select is(
  (select row(action, discussion_id, page_title, note, reason) from public.admin_log order by id desc limit 1),
  row('close_discussion_early'::text, :d1::bigint, '토론 문서'::text, null::text,
    '결론 글 #' || (select max(id) from private.discussion_posts where discussion_id = :d1)),
  'an early close is in the admin log without the discussion title or the conclusion text');
select is(
  (select author_name from private.discussion_posts where discussion_id = :d1 order by id desc limit 1),
  '관리자', 'the admin close is written as the admin');

select login(:bob);
select public.reopen_discussion(:d1, '다시 이야기해 봅시다, 열 글자.');
select lives_ok(format($$select public.close_discussion(%s, '다시 연 사람이 정리합니다.')$$, :d1),
  'the member who opened this round can close at any time');
select public.reopen_discussion(:d1, '세 번째로 다시 엽니다, 열 글자.');
select logout();

update private.discussions set opened_at = now() - interval '25 hours' where id = :d1;
select login(:alice);
select is((public.get_discussion(:d1) ->> 'close_after')::timestamptz < now(), true,
  'close_after tells when anyone can close');
select lives_ok(format($$select public.close_discussion(%s, '하루가 지나 정리합니다.')$$, :d1),
  'anyone can close 24 hours after the round opened');
select logout();
select is((select count(*)::integer from public.admin_log where action = 'close_discussion_early'), 1,
  'a normal close is not in the admin log');

-- ── 거두기 ───────────────────────────────────────────────────────────────────
select login(:alice);
select public.open_discussion(:p1, '거두기 연습', '첫 글') as d2 \gset
select public.add_discussion_post(:d2, '앨리스 둘째 글') as a2 \gset
select logout();

select login(:bob);
select throws_ok(format($$select public.withdraw_discussion_post(%s)$$, :a2), '42501', null,
  'a member cannot withdraw the post of another member');
select public.add_discussion_post(:d2, '밥의 답글') as b2 \gset
select logout();
select id as d2open from private.discussion_posts where discussion_id = :d2 and kind = 'open' \gset

select login(:alice);
select throws_ok(format($$select public.withdraw_discussion_post(%s)$$, :a2), 'WK024', null,
  'a post with a reply after it cannot be withdrawn');
select throws_ok(format($$select public.withdraw_discussion(%s)$$, :d2), 'WK024', null,
  'a discussion with replies cannot be withdrawn');
select throws_ok(format($$select public.withdraw_discussion_post(%s)$$, :d2open),
  'WK024', null, 'the opening post is withdrawn only with the discussion');
select logout();

select login(:bob);
select throws_ok(format($$select public.withdraw_discussion(%s)$$, :d2), '42501', null,
  'only the opener can withdraw a discussion');
select lives_ok(format($$select public.withdraw_discussion_post(%s)$$, :b2), 'a member can withdraw their last post');
select is((public.get_discussion(:d2) #>> '{posts,2,state}'), 'withdrawn', 'a withdrawn post shows as withdrawn');
select is((public.get_discussion(:d2) #>> '{posts,2,body}'), null, 'a withdrawn post has no body for members');
select logout();

select login(:alice);
select lives_ok(format($$select public.withdraw_discussion_post(%s)$$, :a2),
  'a post can be withdrawn once the replies after it are withdrawn');
select is(public.withdraw_discussion(:d2), '토론 문서',
  'the opener can withdraw a discussion with no replies left and gets the page title back');
select throws_ok(format($$select public.get_discussion(%s)$$, :d2), 'WK006', null,
  'a withdrawn discussion cannot be read');
select logout();

select login(:admin);
select throws_ok(format($$select public.get_discussion(%s)$$, :d2), 'WK006', null,
  'nobody can read a withdrawn discussion, not even the admin');
select logout();

-- ── 관리자 동작 ──────────────────────────────────────────────────────────────
select login(:alice);
select public.open_discussion(:p1, '관리 연습', '비방 섞인 글', :r2) as d3 \gset
select (public.get_discussion(:d3) #>> '{posts,0,id}')::bigint as d3p \gset
select throws_ok(format($$select public.set_discussion_post_hidden(%s, true, '비방')$$, :d3p), '42501', null,
  'a member cannot hide a post');
select throws_ok(format($$select public.set_discussion_deleted(%s, true, '비방')$$, :d3), '42501', null,
  'a member cannot delete a discussion');
select logout();

select login(:admin);
select throws_ok(format($$select public.set_discussion_post_hidden(%s, true, ' ')$$, :d3p), 'WK014', null,
  'hiding a post needs a reason');
select lives_ok(format($$select public.set_discussion_post_hidden(%s, true, '비방')$$, :d3p), 'the admin can hide a post');
select throws_ok(format($$select public.set_discussion_post_hidden(%s, true, '비방')$$, :d3p), 'WK011', null,
  'a hidden post cannot be hidden again');
select is((public.get_discussion(:d3) #>> '{posts,0,body}'), '비방 섞인 글', 'the admin still sees a hidden post');
select logout();
select is(
  (select row(action, discussion_id, pseudonym, note) from public.admin_log order by id desc limit 1),
  row('hide_discussion_post'::text, :d3::bigint,
    (select author_name from private.discussion_posts where id = :d3p), null::text),
  'hiding a post is in the admin log without the discussion title');

select login(:bob);
select is((public.get_discussion(:d3) #>> '{posts,0,state}'), 'hidden', 'members see the post as hidden');
select is((public.get_discussion(:d3) #>> '{posts,0,body}'), null, 'members do not get the body of a hidden post');
select logout();

select login(:bob);
select throws_ok(format($$select public.rename_discussion(%s, '새 제목')$$, :d3), '42501', null,
  'a member cannot rename a discussion');
select logout();

select login(:admin);
select lives_ok(format($$select public.rename_discussion(%s, '  바꾼 제목  ')$$, :d3),
  'the admin can rename a discussion');
select is((public.get_discussion(:d3) ->> 'title'), '바꾼 제목', 'the new title is trimmed and saved');
select is(
  (select row(post ->> 'kind', post ->> 'author_name', post ->> 'as_admin')::text
    from (select public.get_discussion(:d3) -> 'posts' -> -1 as post) as last),
  row('rename', '관리자', 'true')::text,
  'renaming leaves a post by the admin in the discussion');
select throws_ok(format($$select public.rename_discussion(%s, '바꾼 제목')$$, :d3), 'WK011', null,
  'renaming to the same title fails');
select throws_ok(format($$select public.rename_discussion(%s, ' ')$$, :d3), 'WK014', null,
  'the title cannot be empty');
select logout();

-- 제목 바꾸기 글은 답글로 세지 않는다. 숨긴 글은 거둘 수 없다.
select login(:alice);
select public.open_discussion(:p1, '제목 오타', '첫 글') as d5 \gset
select public.add_discussion_post(:d5, '덧붙임') as a5 \gset
select public.add_discussion_post(:d5, '숨길 글') as a6 \gset
select logout();
select login(:admin);
select public.rename_discussion(:d5, '제목 고침');
select public.set_discussion_post_hidden(:a6, true, '비방');
select logout();
select login(:alice);
select throws_ok(format($$select public.withdraw_discussion_post(%s)$$, :a6), 'WK024', null,
  'a hidden post cannot be withdrawn');
select logout();
select login(:admin);
select public.set_discussion_post_hidden(:a6, false, '오해');
select logout();
select login(:alice);
select lives_ok(format($$select public.withdraw_discussion_post(%s)$$, :a6),
  'a rename post after my post does not block withdrawing it');
select lives_ok(format($$select public.withdraw_discussion_post(%s)$$, :a5),
  'the next post can be withdrawn too');
select lives_ok(format($$select public.withdraw_discussion(%s)$$, :d5),
  'a rename post does not block withdrawing the discussion');
select logout();

select login(:admin);
select lives_ok(format($$select public.set_discussion_post_hidden(%s, false, '오해')$$, :d3p), 'the admin can unhide a post');
select lives_ok(format($$select public.set_discussion_deleted(%s, true, '도배')$$, :d3), 'the admin can delete a discussion');
select is((select deleted from public.list_page_discussions(:p1) where id = :d3), true,
  'the admin sees a deleted discussion in the list');
select is((select count(*)::integer from public.list_recent_discussions() where id = :d3), 0,
  'recent discussions leave out a deleted discussion, even for the admin');
select logout();

select login(:bob);
select throws_ok(format($$select public.get_discussion(%s)$$, :d3), 'WK006', null,
  'members cannot read a deleted discussion');
select is((select count(*)::integer from public.list_page_discussions(:p1) where id = :d3), 0,
  'members do not see a deleted discussion in the list');
select throws_ok(format($$select public.add_discussion_post(%s, '글')$$, :d3), 'WK006', null,
  'nobody can reply to a deleted discussion');
select logout();

select login(:admin);
select lives_ok(format($$select public.set_discussion_deleted(%s, false, '복구')$$, :d3), 'the admin can restore a discussion');
select logout();

-- ── 읽기 ─────────────────────────────────────────────────────────────────────
select login(:bob);
select is(public.get_discussion_version(:d1), public.get_discussion(:d1) ->> 'version',
  'the version matches the one get_discussion returns');
select is(public.get_discussion_version(999999), null, 'a missing discussion has no version');
select public.get_discussion_version(:d1) as v_before \gset
select logout();
select login(:alice);
select is(public.get_discussion_version(:d1), :'v_before', 'the version is the same for every reader');
select logout();
update private.discussion_posts set hidden_at = now()
  where id = (select max(id) from private.discussion_posts where discussion_id = :d1);
select login(:bob);
select isnt(public.get_discussion_version(:d1), :'v_before', 'hiding a post changes the version');
select logout();
update private.discussion_posts set hidden_at = null
  where id = (select max(id) from private.discussion_posts where discussion_id = :d1);
select login(:bob);
select is(public.get_discussion_version(:d1), :'v_before', 'the version follows the state, not the time');
select logout();

select login(:bob);
select is(public.count_open_discussions(:p1), 1, 'the open count leaves out closed and withdrawn discussions');
select is((public.get_page_view('토론 문서') ->> 'open_discussions')::integer, 1, 'the page view carries the open count');
select results_eq(
  format($$select id from public.list_page_discussions(%s)$$, :p1),
  format($$values (%s::bigint), (%s::bigint)$$, :d3, :d1),
  'the list is in order of recent activity');
select is((select id from public.list_recent_discussions() limit 1), :d3::bigint,
  'recent discussions start with the most recent activity');
select is(
  (select array_agg(distinct page_title order by page_title) from public.list_recent_discussions()),
  array['다른 문서', '토론 문서'],
  'recent discussions cover every page and carry the page title');
select is(
  (select row(is_open, post_count) from public.list_page_discussions(:p1) where id = :d1),
  row(false, 9),
  'the list shows whether a discussion is open and how many posts it has');
select results_eq(
  format($$select revision_id, discussion_count from public.revision_discussion_counts(%s) order by revision_id$$, :p1),
  format($$values (%s::bigint, 1), (%s::bigint, 1)$$, :r1, :r2),
  'each revision counts the discussions pinned to it');
select logout();

-- 문서를 지우면 토론도 관리자에게만 보인다.
select login(:admin);
select public.delete_page(:p1, '연습');
select logout();
select login(:bob);
select throws_ok(format($$select public.get_discussion(%s)$$, :d1), 'WK006', null,
  'members cannot read a discussion of a deleted page');
select is(public.count_open_discussions(:p1), 0, 'a deleted page has no open discussions for members');
select logout();
select login(:admin);
select throws_ok(format($$select public.reopen_discussion(%s, '삭제된 문서에서 다시 열기')$$, :d1), 'WK008', null,
  'nobody can write in a discussion of a deleted page');
select logout();

-- ── 도배 제한 ────────────────────────────────────────────────────────────────
-- 테스트는 한 트랜잭션이라 now()가 같다. 앞의 글과 토론을 지난 일로 돌려 세지 않게 한다.
update private.discussion_posts set created_at = created_at - interval '2 hours';
update private.discussions set created_at = created_at - interval '2 hours';
select login(:bob);
select page_id as p3 from public.save_revision('도배 연습', null, wiki('판')) \gset
select public.open_discussion(:p3, '도배', '글 1') as d4 \gset
select lives_ok(
  format($$select public.add_discussion_post(%s, '글 ' || n) from generate_series(2, 20) as n$$, :d4),
  'twenty posts fit in ten minutes');
select throws_ok(format($$select public.add_discussion_post(%s, '스물한째')$$, :d4), 'WK005', null,
  'the twenty-first post in ten minutes is refused');
select lives_ok(
  format($$select public.open_discussion(%s, '토론 ' || n, '글') from generate_series(2, 5) as n$$, :p3),
  'five discussions fit in an hour');
select throws_ok(format($$select public.open_discussion(%s, '하나 더', '글')$$, :p3), 'WK005', null,
  'the sixth discussion in an hour is refused');
select logout();

select login(:admin);
select lives_ok(
  format($$select public.add_discussion_post(%s, '관리자 글 ' || n) from generate_series(1, 21) as n$$, :d4),
  'the admin has no post limit');
select logout();

select * from finish();
rollback;
