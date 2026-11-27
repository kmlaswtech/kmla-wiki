-- 문서 쓰기·읽기, 문서별 가명, 충돌, 보이는 범위.
begin;
\ir helpers.inc
select * from no_plan();

-- ── 회원 확인이 없으면 쓰지도 읽지도 못한다 ──────────────────────────────────
select login(:outsider);
select throws_ok(
  $$select * from public.save_revision('신성', null, wiki('본문'))$$, '42501', null,
  'a non-member cannot create a page'
);
select logout();

select login(:expired);
select throws_ok(
  $$select * from public.save_revision('신성', null, wiki('본문'))$$, '42501', null,
  'an expired member cannot create a page'
);
select logout();

-- ── 새 문서 ──────────────────────────────────────────────────────────────────
select login(:alice);
select page_id as p1, revision_id as r1 from public.save_revision(' 귀가 /  정기_귀가 ', null, wiki('첫 판'), '만듦') \gset

select results_eq(
  format($$select title, namespace, parent_key, protection from public.pages where id = %s$$, :p1),
  $$values ('귀가/정기 귀가'::text, 'main'::text, '귀가'::text, 'open'::text)$$,
  'the title is normalized and the parent is derived from the slash'
);
select matches(
  (select author_pseudonym from public.revisions where id = :r1),
  '^익명#[0-9A-F]{6}$',
  'the author is shown as a pseudonym'
);
select author_pseudonym as alice_p1 from public.revisions where id = :r1 \gset
select is(public.my_pseudonym(:p1), :'alice_p1', 'I can learn my own pseudonym on this page');

select throws_ok(
  format($$select * from public.save_revision('귀가/정기 귀가', %s, wiki('첫 판'))$$, :r1),
  'WK007', null, 'saving an unchanged body is rejected'
);
select throws_ok(
  $$select * from public.save_revision('귀가/정기 귀가', null, wiki('다른 사람이 만든 줄 모르고 새로 씀'))$$,
  'WK001', null, 'creating a page that already exists is an edit conflict'
);
select logout();

-- ── 같은 문서의 다른 사람, 충돌 ──────────────────────────────────────────────
select login(:bob);
select revision_id as r2 from public.save_revision('귀가/정기 귀가', :r1, wiki('둘째 판'), '') \gset
select isnt(
  (select author_pseudonym from public.revisions where id = :r2), :'alice_p1',
  'another member gets a different pseudonym on the same page'
);
select is(public.my_pseudonym(:p1), (select author_pseudonym from public.revisions where id = :r2),
  'my_pseudonym is per caller');
select logout();

select login(:alice);
select throws_ok(
  format($$select * from public.save_revision('귀가/정기 귀가', %s, wiki('낡은 판 기준'))$$, :r1),
  'WK001', null, 'saving on top of a stale revision is an edit conflict'
);
select revision_id as r3 from public.save_revision('귀가/정기 귀가', :r2, wiki('셋째 판 [[신성]] [[분류:생활]]')) \gset
select is(
  (select author_pseudonym from public.revisions where id = :r3), :'alice_p1',
  'the same member keeps the same pseudonym on the same page'
);
select results_eq(
  format($$select parent_revision_id, text_size, text_added - text_removed from public.revisions where id = %s$$, :r3),
  -- 크기는 보이는 글자 수로 잰다. 분류는 글자가 아니다.
  format($$select %s::bigint, char_length('셋째 판 신성 '), char_length('셋째 판 신성 ') - char_length('둘째 판')$$, :r2),
  'a revision records its parent, size and change'
);

-- ── 더한 글자·뺀 글자 ────────────────────────────────────────────────────────
-- 내부 함수라 회원은 부를 수 없다. 관리 권한으로 직접 시험한다.
select logout();
select results_eq(
  $$select change.added, change.removed from (values
      (1, null, E'가나다\n라마'),
      (2, E'가나다\n라마', E'가나다\n\n\n라마'),
      (3, E'가나다라마바', E'가나X라마바'),
      (4, E'첫째\n둘째\n셋째', E'셋째\n첫째\n둘째'),
      (5, E'문단 하나입니다\n문단 둘', E'새 문단\n문단 하나였습니다\n문단 둘'),
      (6, E'가나다\n라마', ''),
      -- 한 줄 안의 두 곳: 판 비교의 낱말 표시처럼 "더한"→"고친", "입"→"이었습"만 센다.
      (7, '새로 더한 문단입니다.', '새로 고친 문단이었습니다.')
    ) as sample (n, old, new), private.text_change(sample.old, sample.new) as change
    order by sample.n$$,
  $$values (5, 0), (0, 0), (1, 1), (0, 0), (6, 1), (0, 5), (5, 3)$$,
  'text change counts the characters added and removed, not line breaks or moved paragraphs'
);
select login(:alice);

-- 다른 문서에서는 다른 가명이다. 문서 사이를 잇는 단서가 화면 데이터에 없어야 한다.
select page_id as p2, revision_id as r4 from public.save_revision('신성', null, wiki('신성 시간은…')) \gset
select isnt(
  (select author_pseudonym from public.revisions where id = :r4), :'alice_p1',
  'the same member gets a different pseudonym on a different page'
);

-- ── 파생 정보 ────────────────────────────────────────────────────────────────
select set_eq(
  format($$select kind, target_key from public.page_refs where from_page_id = %s$$, :p1),
  $$values ('link', '신성'), ('category', '분류:생활')$$,
  'links and categories are extracted from the body on save'
);
select is(
  public.page_backlinks('신성'),
  '[{"title": "귀가/정기 귀가", "is_redirect": false}]'::jsonb,
  'backlinks list the pages that link here'
);

-- ── 직접 쓰기는 막혀 있다 ────────────────────────────────────────────────────
select throws_ok($$insert into public.pages (title) values ('몰래')$$, '42501', null,
  'a member cannot insert a page directly');
select throws_ok($$update public.revisions set body = wiki('조작')$$, '42501', null,
  'nor rewrite history');
select throws_ok($$delete from public.pages$$, '42501', null, 'nor delete pages');
select throws_ok($$select * from private.page_pseudonyms$$, '42501', null,
  'nor read who is behind a pseudonym');
select throws_ok($$select * from private.revision_authors$$, '42501', null,
  'nor read who wrote a revision');

-- ── 제목과 상한 ──────────────────────────────────────────────────────────────
select throws_ok($$select * from public.save_revision('나쁜[제목]', null, wiki('x'))$$, 'WK004', null,
  'wiki syntax characters are not allowed in titles');
select throws_ok($$select * from public.save_revision('a/../b', null, wiki('x'))$$, 'WK004', null,
  'path traversal segments are not allowed in titles');
select throws_ok($$select * from public.save_revision('틀:', null, wiki('x'))$$, 'WK004', null,
  'a namespace without a name is not a title');
select throws_ok(
  $$select * from public.save_revision('긴 문서', null, wiki(repeat('가', 400000)))$$, 'WK005', null,
  'a body over the safety limit is rejected');
select throws_ok(
  $$select * from public.save_revision('없는 문서', 12345, wiki('x'))$$, 'WK006', null,
  'editing a page that does not exist is rejected');
select throws_ok(
  $$select * from public.save_revision('빈 문서', null, wiki('   '))$$, 'WK007', null,
  'a new page needs a body');
select lives_ok(
  $$select * from public.save_revision('분류만 있는 문서', null, wiki('[[분류:생활]]'))$$,
  'a page with only a category is not empty');

-- ── 본문 형식 ────────────────────────────────────────────────────────────────
select throws_ok(
  $$select * from public.save_revision('형식', null, '"글"'::jsonb)$$, 'WK012', null,
  'a body must be a document object');
select throws_ok(
  $$select * from public.save_revision('형식', null, '{"type":"doc"}'::jsonb)$$, 'WK012', null,
  'a document needs a content list');
select throws_ok(
  $$select * from public.save_revision('형식', null, '{"type":"doc","attrs":{"categories":"분류:생활"},"content":[]}'::jsonb)$$,
  'WK012', null, 'categories must be a list');
select throws_ok(
  $$select * from public.save_revision('형식', null, '{"type":"doc","content":[{"type":"paragraph","content":[
      {"type":"text","text":"누르기","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}
    ]}]}'::jsonb)$$,
  'WK012', null, 'an external link must be http(s) or mailto');
select lives_ok(
  $$select * from public.save_revision('형식', null, '{"type":"doc","content":[{"type":"paragraph","content":[
      {"type":"text","text":"학교","marks":[{"type":"link","attrs":{"href":"https://kmla.hs.kr"}}]}
    ]}]}'::jsonb)$$,
  'a safe external link is kept');
select throws_ok(
  $$select * from public.save_revision('형식', null, '{"type":"doc","content":[
      {"type":"youtube","attrs":{"videoId":"dQw4w9WgXcQ","caption":"학교 소개"}}
    ]}'::jsonb)$$,
  'WK012', null, 'a caption in the old attribute form is rejected (an editor tab from before the change)');
select throws_ok(
  $$select * from public.save_revision('형식 고장', null,
      (select ('{"type":"doc","content":[' || repeat('{"type":"blockquote","content":[', 150)
               || '{"type":"paragraph"}' || repeat(']}', 150) || ']}')::jsonb))$$,
  'WK012', null, 'deeply nested bodies are rejected');
select throws_ok(
  $$select * from public.save_revision('형식 고장', null,
      '{"type":"doc","content":[{"type":"heading","attrs":{"level":-3},"content":[{"type":"text","text":"가"}]}]}'::jsonb)$$,
  'WK012', null, 'heading levels outside 2-4 are rejected');

-- ── 틀 값 ───────────────────────────────────────────────────────────────────
-- 값은 이름으로 넘긴다(`templateArg{name}`). 값 자리는 `templateParam{name}`이다.
select page_id as p_named from public.save_revision('틀 값을 넘기는 문서', null,
  '{"type":"doc","content":[{"type":"template","attrs":{"name":"틀:알림"},"content":[
     {"type":"templateArg","attrs":{"name":"사유"},"content":[
       {"type":"text","text":"합의 "},
       {"type":"text","text":"토론","marks":[{"type":"wikiLink","attrs":{"target":"토론 문서","section":""}}]}
     ]},
     {"type":"templateArg","attrs":{"name":"기간"},"content":[{"type":"text","text":"한 주"}]}
   ]}]}'::jsonb) \gset
select is(
  (select body_text from public.revisions where page_id = :p_named),
  E'합의 토론\n한 주',
  'template values are searchable text'
);
select ok(
  exists (select 1 from public.page_refs where from_page_id = :p_named and kind = 'link'),
  'links in template values are references'
);
select lives_ok(
  $$select * from public.save_revision('틀:알림', null,
      '{"type":"doc","attrs":{"params":{"사유":{"hint":"왜 붙였나","default":"없음"}}},
        "content":[{"type":"paragraph","content":[{"type":"templateParam","attrs":{"name":"사유"}}]}]}'::jsonb)$$,
  'a template page keeps hints and defaults for its values');
select throws_ok(
  $$select * from public.save_revision('형식 고장', null,
      '{"type":"doc","content":[{"type":"template","attrs":{"name":"틀:알림","args":["가"]}}]}'::jsonb)$$,
  'WK012', null, 'numbered template values are rejected (an editor tab from before the change)');
select throws_ok(
  $$select * from public.save_revision('형식 고장', null,
      '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"templateParam","attrs":{"index":1}}]}]}'::jsonb)$$,
  'WK012', null, 'numbered value places are rejected');
select throws_ok(
  $$select * from public.save_revision('형식 고장', null,
      '{"type":"doc","content":[{"type":"template","attrs":{"name":"틀:알림"},"content":[
         {"type":"templateArg","attrs":{"name":" 사유"}}]}]}'::jsonb)$$,
  'WK012', null, 'a value name may not start or end with a space');
select throws_ok(
  $$select * from public.save_revision('형식 고장', null,
      '{"type":"doc","content":[{"type":"paragraph","content":[
         {"type":"templateParam","attrs":{"name":"일이삼사오육칠팔구십일이삼사오육칠팔구십일"}}]}]}'::jsonb)$$,
  'WK012', null, 'a value name has at most 20 characters');
select throws_ok(
  $$select * from public.save_revision('형식 고장', null,
      '{"type":"doc","content":[{"type":"template","attrs":{"name":"틀:알림"},"content":[
         {"type":"templateArg","attrs":{"name":"사유"}},{"type":"templateArg","attrs":{"name":"사유"}}]}]}'::jsonb)$$,
  'WK012', null, 'a template call may not pass the same value twice');
select throws_ok(
  $$select * from public.save_revision('형식 고장', null,
      '{"type":"doc","attrs":{"params":{"사유":{"hint":3}}},"content":[]}'::jsonb)$$,
  'WK012', null, 'a value hint must be text');
select throws_ok(
  $$select * from public.save_revision('형식 고장', null,
      '{"type":"doc","attrs":{"params":{"사유":{"color":"빨강"}}},"content":[]}'::jsonb)$$,
  'WK012', null, 'value settings are only a hint and a default');

-- ── 프로필 ──────────────────────────────────────────────────────────────────
-- 프로필은 본문과 같은 블록 노드 목록이다(`attrs.profile`).
select page_id as p_profile from public.save_revision('프로필만 있는 문서', null,
  '{"type":"doc","content":[{"type":"paragraph"}],"attrs":{"profile":[
     {"type":"paragraph","content":[{"type":"text","text":"은하수 동아리"}]},
     {"type":"paragraph","content":[
       {"type":"text","text":"분야 천문 관측 "},
       {"type":"text","text":"과학관","marks":[{"type":"wikiLink","attrs":{"target":"과학관","section":""}}]}
     ]}]}}'::jsonb) \gset
select ok(:p_profile is not null, 'a page with only a profile is not empty');
select is(
  (select body_text from public.revisions where page_id = :p_profile),
  E'은하수 동아리\n분야 천문 관측 과학관',
  'the profile text is part of the searchable body text'
);
select ok(
  exists (select 1 from public.page_refs where from_page_id = :p_profile and kind = 'link'),
  'links in the profile are references'
);
select throws_ok(
  $$select * from public.save_revision('프로필 고장', null,
      '{"type":"doc","content":[],"attrs":{"profile":{"title":"가"}}}'::jsonb)$$,
  'WK012', null, 'a profile is a list of blocks');
select throws_ok(
  $$select * from public.save_revision('프로필 고장', null,
      '{"type":"doc","content":[],"attrs":{"profile":["가"]}}'::jsonb)$$,
  'WK012', null, 'profile blocks are nodes');
select throws_ok(
  $$select * from public.save_revision('프로필 고장', null,
      '{"type":"doc","content":[],"attrs":{"profile":[{"type":"paragraph","content":[
        {"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}]}}'::jsonb)$$,
  'WK012', null, 'links in the profile are checked like the body');
select throws_ok(
  $$select * from public.save_revision('프로필 넘겨주기', null,
      '{"type":"doc","content":[{"type":"paragraph"}],"attrs":{"redirect":"과학관",
        "profile":[{"type":"paragraph","content":[{"type":"text","text":"가"}]}]}}'::jsonb)$$,
  'WK015', null, 'a redirect page has no profile');

-- 대소문자만 다른 제목은 같은 문서다.
select page_id as p3, revision_id as r5 from public.save_revision('PRISM', null, wiki('프리즘')) \gset
select throws_ok($$select * from public.save_revision('Prism', null, wiki('또 프리즘'))$$, 'WK001', null,
  'titles are unique regardless of letter case');

-- ── 되돌리기 ─────────────────────────────────────────────────────────────────
select revision_id as r6 from public.revert_page(:r2, '실수') \gset
select results_eq(
  format($$select body, kind, summary from public.revisions where id = %s$$, :r6),
  format($$values (wiki('둘째 판'), 'revert'::text, 'r%s 판으로 되돌림: 실수'::text)$$, :r2),
  'reverting writes a new revision with the old body'
);
select is(
  (select count(*) from public.revisions where page_id = :p1), 4::bigint,
  'reverting keeps the whole history'
);
select is_empty(
  format($$select 1 from public.page_refs where from_page_id = %s$$, :p1),
  'reverting recomputes the derived references'
);
select throws_ok(format($$select * from public.revert_page(%s)$$, :r2), 'WK007', null,
  'reverting to the current content is rejected');

-- ── 이동과 넘겨주기 ──────────────────────────────────────────────────────────
select throws_ok($$select * from public.move_page('신성', 'prism')$$, 'WK009', null,
  'a page cannot be moved onto an existing title');
select revision_id as r7 from public.move_page('신성', '신성 시간') \gset
select is((select title from public.pages where id = :p2), '신성 시간', 'moving renames the page');
select is(
  (select author_pseudonym from public.revisions where id = :r7),
  (select author_pseudonym from public.revisions where id = :r4),
  'moving keeps my pseudonym because the page is the same page'
);
select results_eq(
  $$select redirect_target from public.pages where title = '신성'$$,
  $$values ('신성 시간'::text)$$,
  'moving leaves a redirect at the old title'
);
select is(
  (select revision.body -> 'attrs' ->> 'redirect'
   from public.pages as page join public.revisions as revision on revision.id = page.current_revision_id
   where page.title = '신성'),
  '신성 시간',
  'the redirect is a document with the redirect attribute'
);
select is(
  public.get_page_view('신성') ->> 'title', '신성 시간',
  'viewing a redirect shows the target'
);
select is(
  public.get_page_view('신성') ->> 'redirected_from', '신성',
  'and says where the reader came from'
);
select is(
  public.get_page_view('신성', false) ->> 'title', '신성',
  'the redirect page itself can still be opened'
);
select is(
  public.get_page_view('없는 문서') -> 'found', 'false'::jsonb,
  'a missing page is reported as not found rather than as an error'
);
select is(
  public.get_page_view('귀가/정기_귀가') -> 'revision' -> 'body', wiki('둘째 판'),
  'the view carries the current body'
);

-- ── 검색 ─────────────────────────────────────────────────────────────────────
select results_eq(
  $$select title, matched_redirect from public.search_pages('신성')$$,
  $$values ('신성 시간'::text, null::text)$$,
  'search finds a page by title and does not list its redirect separately'
);
select results_eq(
  $$select title from public.search_pages('프리즘')$$,
  $$values ('PRISM'::text)$$,
  'search finds a page by body'
);
select lives_ok(
  $$select * from public.save_revision('꾸밈 시험', null, '{"type":"doc","content":[{"type":"paragraph","content":[
      {"type":"text","text":"저녁","marks":[{"type":"bold"}]},{"type":"text","text":" 점호 뒤"}
    ]}]}'::jsonb)$$,
  'a formatted page is saved');
select results_eq(
  $$select title, snippet from public.search_pages('저녁 점호')$$,
  $$values ('꾸밈 시험'::text, '저녁 점호 뒤'::text)$$,
  'search finds words across formatting and shows plain text'
);
select logout();

-- 넘겨주기 이름으로만 맞는 경우.
select login(:bob);
select page_id as p4 from public.save_revision('중베', null, wiki('#넘겨주기 [[PRISM]]')) \gset
select results_eq(
  $$select title, matched_redirect from public.search_pages('중베')$$,
  $$values ('PRISM'::text, '중베'::text)$$,
  'search by a redirect name returns the target page'
);
select logout();

-- ── 차단, 보호, 삭제, 숨김 ───────────────────────────────────────────────────
insert into private.bans (member_id, reason)
select id, '훼손' from private.members where kmla_profile_id = 9002;

select login(:bob);
select throws_ok(
  format($$select * from public.save_revision('PRISM', %s, wiki('차단 중 편집'))$$, :r5), 'WK002', null,
  'a banned member cannot edit any page');
select throws_ok($$select * from public.move_page('PRISM', 'P')$$, 'WK002', null,
  'nor move one');
select isnt_empty($$select 1 from public.pages$$, 'but can still read');
select logout();

update public.pages set protection = 'admin' where id = :p3;
select login(:alice);
select throws_ok(
  format($$select * from public.save_revision('PRISM', %s, wiki('보호 문서 편집'))$$, :r5), 'WK003', null,
  'a member cannot edit a protected page');
select logout();
select login(:admin);
select lives_ok(
  format($$select * from public.save_revision('PRISM', %s, wiki('관리자 편집'))$$, :r5),
  'an admin can edit a protected page');
select logout();

update public.revisions set hidden_at = now() where id = :r1;
update public.pages set deleted_at = now() where id = :p2;

select login(:alice);
select is_empty(format($$select 1 from public.revisions where id = %s$$, :r1),
  'a hidden revision is invisible to members');
select throws_ok(format($$select * from public.revert_page(%s)$$, :r1), 'WK006', null,
  'and cannot be restored by reverting to it');
select is_empty(format($$select 1 from public.pages where id = %s$$, :p2),
  'a deleted page is invisible to members');
select is_empty(format($$select 1 from public.revisions where page_id = %s$$, :p2),
  'and so is its history');
select throws_ok(
  $$select * from public.save_revision('신성 시간', null, wiki('다시 만들기'))$$, 'WK008', null,
  'a deleted page cannot be recreated by a member');
select is(public.get_page_view('신성 시간') -> 'found', 'false'::jsonb,
  'viewing a deleted page says not found');
select logout();

select login(:admin);
select isnt_empty(format($$select 1 from public.revisions where id = %s$$, :r1),
  'an admin still sees a hidden revision');
select isnt_empty(format($$select 1 from public.pages where id = %s$$, :p2),
  'and a deleted page');
select logout();

select login(:outsider);
select is_empty($$select 1 from public.pages$$, 'a non-member sees no pages');
select is_empty($$select 1 from public.revisions$$, 'no revisions');
select is_empty($$select 1 from public.page_refs$$, 'and no references');
select logout();

-- ── 분류의 문서 템플릿 ─────────────────────────────────────────────────────────
select login(:alice);
select public.save_revision('분류:템플릿 분류', null, wiki('분류 문서'));
select public.save_revision('템플릿 분류 문서', null, wiki('본문 [[분류:템플릿 분류]]'));
select public.save_revision('위키:템플릿/템플릿 분류', null, wiki('템플릿 [[분류:템플릿 분류]]'));

select is(
  public.get_page_view('분류:템플릿 분류') -> 'members',
  '["템플릿 분류 문서"]'::jsonb,
  'a category lists its pages without its presets');
select is(
  public.get_page_view('분류:템플릿 분류') -> 'presets',
  '["위키:템플릿/템플릿 분류"]'::jsonb,
  'a category lists its presets apart');
select is(
  public.get_page_view('템플릿 분류 문서') -> 'presets',
  '[]'::jsonb,
  'a page that is not a category has no presets');
select logout();

-- ── 저장 빈도 상한 ───────────────────────────────────────────────────────────
with written as (
  insert into public.revisions (page_id, body, author_pseudonym, kind, text_size, text_added, text_removed)
  select :p1, wiki('x'), '익명#000000', 'edit', 1, 0, 0 from generate_series(1, 60)
  returning id
)
insert into private.revision_authors (revision_id, member_id)
select written.id, (select id from private.members where kmla_profile_id = 9001)
from written;

select login(:alice);
select throws_ok(
  $$select * from public.save_revision('상한 시험', null, wiki('x'))$$, 'WK005', null,
  'sixty saves in ten minutes trips the safety limit');
select logout();

select * from finish();
rollback;
