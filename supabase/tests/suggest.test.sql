-- 제목 자동완성: 넓힌 패턴으로 찾고, 글자 그대로 맞는 것부터 보여 준다.
--
-- 패턴은 앱(`features/pages/model/hangul-match.ts`)이 만든다. 여기서는 앱이 만드는 꼴의 패턴을
-- 손으로 적어, PostgreSQL 정규식으로 그대로 동작하는지와 순위를 본다.
begin;
\ir helpers.inc
select * from no_plan();

select login(:alice);
select public.save_revision('가', null, wiki('정확히 맞는 문서'));
select public.save_revision('가나', null, wiki('앞부분이 맞는 문서'));
select public.save_revision('나가', null, wiki('가운데에 있는 문서'));
select public.save_revision('각도', null, wiki('넓혀서 맞는 문서(가 + 받침)'));
select public.save_revision('갈매기', null, wiki('넓혀서 맞는 문서(가 + 받침)'));
select public.save_revision('괄호(시험).', null, wiki('정규식 기호가 든 제목'));
select public.save_revision('틀:가이드', null, wiki('틀'));
select public.save_revision('틀:안내', null, wiki('틀'));
select public.save_revision('지운 가', null, wiki('지운다'));
select public.save_revision('별명', null, wiki('#넘겨주기 [[가나]]'));
select public.save_revision('끊긴 별명', null, wiki('#넘겨주기 [[없는 문서]]'));
select public.save_revision('틀:옛 안내', null, wiki('#넘겨주기 [[가나]]'));
select public.save_revision('틀:새 안내', null, wiki('#넘겨주기 [[틀:안내]]'));
select logout();

select login(:admin);
select public.delete_page((select id from public.pages where title = '지운 가'), '시험');
select logout();

select login(:alice);

-- `가` → (?:가|[가-갛]). 앱이 만드는 패턴과 같다(hangul-match.test.ts의 "DB 테스트와 같은 패턴").
select results_eq(
  $$select title from public.suggest_titles('가', '(?:가|[가-갛])', '', 5)$$,
  $$values ('가'::text), ('가나'::text), ('나가'::text), ('틀:가이드'::text), ('각도'::text)$$,
  'exact, then literal prefix, then literal substring (any namespace), then widened matches; deleted pages are left out'
);

select results_eq(
  $$select title from public.suggest_titles('가', '(?:가|[가-갛])', '틀:', 8)$$,
  $$values ('틀:가이드'::text)$$,
  'a namespace prefix limits matches to that namespace and matches after the prefix'
);

select results_eq(
  $$select title from public.suggest_titles('괄호(시', '괄호\((?:시|[시-싷])', '', 8)$$,
  $$values ('괄호(시험).'::text)$$,
  'escaped regex characters match literally'
);

select is_empty(
  $$select title from public.suggest_titles('괄호.', '괄호\.', '', 8)$$,
  'an escaped dot does not match any character'
);

select results_eq(
  $$select title, redirect_target from public.suggest_titles('별명', '별명', '', 8) where title = '별명'$$,
  $$values ('별명'::text, '가나'::text)$$,
  'redirect pages are suggested together with their target'
);

select results_eq(
  $$select title, redirect_target from public.suggest_titles('끊긴 별명', '끊긴 별명', '', 8)$$,
  $$values ('끊긴 별명'::text, null::text)$$,
  'a redirect to a missing page is suggested without a target'
);

select results_eq(
  $$select title, redirect_target from public.suggest_titles('안내', '안내', '틀:', 8)$$,
  $$values ('틀:안내'::text, null::text), ('틀:새 안내'::text, '틀:안내'::text), ('틀:옛 안내'::text, null::text)$$,
  'inside a namespace, a redirect target outside that namespace is left out'
);

select is(
  (select count(*) from public.suggest_titles('', '', '', 1000))::integer,
  8,
  'the limit is capped'
);
select logout();

select login(:outsider);
select is_empty(
  $$select title from public.suggest_titles('가', '가', '', 8)$$,
  'members only: RLS hides pages from accounts without member verification'
);
select logout();

select * from finish();
rollback;
