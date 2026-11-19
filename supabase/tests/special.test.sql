-- 특수 기능 목록: 작성이 필요한 문서, 고립된 문서, 모든 문서.
begin;
\ir helpers.inc
select * from no_plan();

select login(:alice);
select public.save_revision('기숙사', null, wiki('[[점호]]와 [[외출]], [[귀가]]'));
select public.save_revision('귀가', null, wiki('[[점호]] 뒤에 한다'));
select public.save_revision('귀가/정기 귀가', null, wiki('하위 문서'));
select public.save_revision('고립', null, wiki('아무도 링크하지 않는다. [[고립]] 자기 자신 링크는 세지 않는다'));
select public.save_revision('넘겨받음', null, wiki('넘겨주기로만 찾아온다'));
select public.save_revision('넘겨주기', null, wiki('#넘겨주기 [[넘겨받음]]'));
select public.save_revision('틀:안내', null, wiki('[[없는 틀 링크]]'));
select public.save_revision('지운 문서', null, wiki('[[지운 데서만 가리킴]]'));
select logout();

select login(:admin);
select public.delete_page((select id from public.pages where title = '지운 문서'), '시험');
select logout();

select login(:alice);
select results_eq(
  $$select title_key, ref_count from public.wanted_pages()$$,
  $$values ('점호'::text, 2), ('없는 틀 링크'::text, 1), ('외출'::text, 1)$$,
  'wanted pages are counted by linking pages, most wanted first, ignoring deleted sources'
);

select set_eq(
  $$select title from public.orphan_pages()$$,
  $$values ('고립'::text), ('기숙사'::text)$$,
  'orphans exclude linked, redirected-to, subpages with a parent, redirects and non-main pages'
);

select results_eq(
  $$select title from public.list_all_pages()$$,
  $$values ('고립'::text), ('귀가'::text), ('귀가/정기 귀가'::text), ('기숙사'::text), ('넘겨받음'::text)$$,
  'all pages lists main pages in title order without redirects or deleted pages'
);
select results_eq(
  $$select title from public.list_all_pages('main', '귀가/정기 귀가', 2)$$,
  $$values ('기숙사'::text), ('넘겨받음'::text)$$,
  'all pages continues after the given title'
);
select results_eq(
  $$select title from public.list_all_pages('template')$$,
  $$values ('틀:안내'::text)$$,
  'all pages can list another namespace'
);
select is(
  (select title from public.page_sizes() limit 1),
  '귀가/정기 귀가',
  'short pages start with the smallest page'
);
select is(
  (select title from public.page_sizes('main', true) limit 1),
  '고립',
  'long pages start with the largest page'
);
select set_eq(
  $$select title from public.page_sizes()$$,
  $$values ('고립'::text), ('귀가'::text), ('귀가/정기 귀가'::text), ('기숙사'::text), ('넘겨받음'::text)$$,
  'page sizes list main pages without redirects or deleted pages'
);
select ok(
  (select bool_and(byte_size > 0) from public.page_sizes()),
  'page sizes come with the byte size'
);
select results_eq(
  $$select title from public.page_sizes('main', false, 1, 2)$$,
  $$select title from public.page_sizes() offset 1 limit 2$$,
  'page sizes continue from the given offset'
);
select results_eq(
  $$select title from public.page_sizes('template')$$,
  $$values ('틀:안내'::text)$$,
  'page sizes can list another namespace'
);
select logout();

-- 회원 확인이 없으면 RLS 때문에 아무것도 보이지 않는다.
select login(:expired);
select is_empty($$select * from public.wanted_pages()$$, 'an expired member sees no wanted pages');
select is_empty($$select * from public.list_all_pages()$$, 'an expired member sees no pages');
select is_empty($$select * from public.page_sizes()$$, 'an expired member sees no page sizes');
select logout();

select * from finish();
rollback;
