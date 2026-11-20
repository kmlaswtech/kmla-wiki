-- 일괄 되돌리기: 한 사람이 시작점부터 쓴 판을 여러 문서에서 한 번에 걷어 낸다.
begin;
\ir helpers.inc
select * from no_plan();

-- 준비. 밥이 시작점 앞에 한 번, 뒤에 여러 문서를 훼손한다.
--   마: 시작점 앞의 편집만 있다(범위 밖).
--   가: 밥이 고친 판이 현재 판이다 → 되돌림.
--   나: 밥 뒤에 앨리스가 고쳤다 → 충돌.
--   다: 밥이 만든 문서다 → 삭제.
--   라: 밥이 라2로 옮겼다 → 라2는 본문이 같고, 옛 이름의 넘겨주기는 삭제 후보(이동이 남긴 것).
select login(:alice);
select page_id as pm, revision_id as am from public.save_revision('문서 마', null, wiki('마 원래')) \gset
select page_id as pa, revision_id as a0 from public.save_revision('문서 가', null, wiki('가 원래')) \gset
select page_id as pb, revision_id as a1 from public.save_revision('문서 나', null, wiki('나 원래')) \gset
select page_id as pd, revision_id as a3 from public.save_revision('문서 라', null, wiki('라 원래')) \gset
select page_id as pe, revision_id as a4 from public.save_revision('문서 바', null, wiki('바 원래')) \gset
select page_id as pf, revision_id as a5 from public.save_revision('문서 사', null, wiki('사 원래')) \gset
select revision_id as a6 from public.save_revision('문서 사', :a5, wiki('사에 실명을 씀')) \gset
select logout();

select login(:bob);
select revision_id as b0 from public.save_revision('문서 마', :am, wiki('마 훼손')) \gset
select revision_id as b1 from public.save_revision('문서 가', :a0, wiki('가 훼손')) \gset
select revision_id as b2 from public.save_revision('문서 나', :a1, wiki('나 훼손')) \gset
select page_id as pc, revision_id as b3 from public.save_revision('문서 다', null, wiki('다 장난')) \gset
select revision_id as b4 from public.move_page('문서 라', '문서 라2', true) \gset
select id as pleft from public.pages where title = '문서 라' \gset
select revision_id as b5 from public.save_revision('문서 바', :a4, wiki('바 훼손 하나')) \gset
select revision_id as b7 from public.save_revision('문서 사', :a6, wiki('사 훼손')) \gset
select logout();

select login(:alice);
select revision_id as a2 from public.save_revision('문서 나', :b2, wiki('나 다시 고침')) \gset
select revision_id as a7 from public.save_revision('문서 바', :b5, wiki('바 훼손 하나, 앨리스 덧붙임')) \gset
select logout();

select login(:bob);
select revision_id as b6 from public.save_revision('문서 바', :a7, wiki('바 훼손 둘')) \gset
select logout();

-- 사의 실명 판(a6)을 관리자가 숨겼다. 밥의 판을 걷어 내면 돌아갈 판이 이 숨긴 판이다.
select login(:admin);
select public.set_revision_hidden(:a6, true, '실명');
select logout();

-- 한 테스트는 한 트랜잭션이라 모든 판의 시각이 같다. 실제처럼 판마다 시각을 벌리고, 이동이 남긴
-- 넘겨주기만 이동 판과 같은 시각(같은 트랜잭션)으로 둔다.
update public.revisions set created_at = now() - interval '1 second' * (10000 - id);
update public.revisions
   set created_at = (select created_at from public.revisions where id = :b4)
 where page_id = :pleft;
update private.revision_authors as author
   set created_at = (select revision.created_at from public.revisions as revision where revision.id = author.revision_id);

-- ── 관리자만 ─────────────────────────────────────────────────────────────────
select login(:admin);
select open_author_lookup as lookup from public.open_author_lookup(:b1, '여러 문서 훼손') \gset
select logout();

select login(:alice);
select throws_ok(format($$select * from public.preview_bulk_revert(%L, %s)$$, :'lookup', :b1), '42501', null,
  'a member cannot preview a bulk revert');
select throws_ok(
  format($$select * from public.bulk_revert(%L, %s, '[]', '훼손')$$, :'lookup', :b1), '42501', null,
  'a member cannot run a bulk revert');
select logout();

-- ── 미리보기 ─────────────────────────────────────────────────────────────────
select login(:admin);
select set_eq(
  format($$select page_title, status, restore_revision_id, edit_count, kept_count, has_move, move_leftover
           from public.preview_bulk_revert(%L, %s)$$, :'lookup', :b1),
  format($$values
    ('문서 가'::text, 'revert'::text, %s::bigint, 1, 0, false, false),
    ('문서 나', 'conflict', %s, 1, 0, false, false),
    ('문서 다', 'delete', null, 1, 0, false, false),
    ('문서 라2', 'same', %s, 1, 0, true, false),
    ('문서 라', 'delete', null, 1, 0, false, true),
    ('문서 바', 'revert', %s, 1, 1, false, false),
    ('문서 사', 'hidden', %s, 1, 0, false, false)$$, :a0, :a2, :a3, :a7, :a6),
  'the preview plans each page the author touched from the start point'
);
select is(
  (select status from public.preview_bulk_revert(:'lookup') where page_title = '문서 마'),
  'revert',
  'without a start point the plan covers every edit'
);
select is(
  (select count(*) from public.admin_log where action = 'bulk_revert'), 0::bigint,
  'a preview is not recorded'
);

-- ── 실행 ─────────────────────────────────────────────────────────────────────
select throws_ok(
  format($$select * from public.bulk_revert(%L, %s, '[]', ' ')$$, :'lookup', :b1), 'WK014', null,
  'a bulk revert requires a reason');
select throws_ok(
  format($$select * from public.bulk_revert(%L, %s, '[]', '훼손')$$, :'lookup', :b1), 'WK007', null,
  'a bulk revert needs at least one page');
select throws_ok(
  format(
    $$select * from public.bulk_revert(%L, %s,
        (select jsonb_agg(jsonb_build_object('page_id', n, 'current_revision_id', n)) from generate_series(1, 201) as n),
        '훼손')$$,
    :'lookup', :b1),
  'WK018', null,
  'a bulk revert takes at most 200 pages');

-- 걷어 낼 판(가의 b1)과 삭제할 문서의 판(다의 b3)에 신고가 있다. 실행하면 닫힌다.
select public.report_revision(id, 'vandalism') from unnest(array[:b1, :b3]::bigint[]) as id;

-- 나(충돌)와 라2(본문 같음)도 보내지만 건너뛴다.
select set_eq(
  format(
    $$select page_title, outcome from public.bulk_revert(%L, %s, %L::jsonb, '여러 문서 훼손')$$,
    :'lookup', :b1,
    jsonb_build_array(
      jsonb_build_object('page_id', :pa, 'current_revision_id', :b1),
      jsonb_build_object('page_id', :pb, 'current_revision_id', :a2),
      jsonb_build_object('page_id', :pc, 'current_revision_id', :b3),
      jsonb_build_object('page_id', :pd, 'current_revision_id', :b4),
      jsonb_build_object('page_id', :pleft, 'current_revision_id',
        (select current_revision_id from public.pages where id = :pleft)),
      jsonb_build_object('page_id', :pf, 'current_revision_id', :b7)
    )
  ),
  $$values ('문서 가'::text, 'reverted'::text), ('문서 나', 'skipped'), ('문서 다', 'deleted'),
           ('문서 라2', 'skipped'), ('문서 라', 'deleted'), ('문서 사', 'skipped')$$,
  'reverts and deletes what the plan allows and skips the rest'
);
select is(
  (select body from public.revisions where id = (select current_revision_id from public.pages where id = :pf)),
  wiki('사 훼손'),
  'a hidden revision is never copied into a new visible one'
);
select results_eq(
  format($$select revision.body, revision.author_pseudonym, revision.kind, revision.summary
           from public.pages as page join public.revisions as revision on revision.id = page.current_revision_id
           where page.id = %s$$, :pa),
  format($$select wiki('가 원래'), '관리자'::text, 'revert'::text, 'r%s 판으로 되돌림: 일괄 되돌리기'::text$$, :a0),
  'a reverted page gets the old body back as an admin revision'
);
select is(
  (select body from public.revisions where id = (select current_revision_id from public.pages where id = :pb)),
  wiki('나 다시 고침'),
  'a page someone else edited afterwards is left alone'
);
select isnt(
  (select deleted_at from public.pages where id = :pc), null,
  'a page the author created is deleted (and can be restored)'
);
select set_eq(
  format($$select page_title, status from public.preview_bulk_revert(%L, %s)$$, :'lookup', :b1),
  $$values ('문서 가'::text, 'clean'::text), ('문서 나', 'conflict'), ('문서 다', 'deleted'),
           ('문서 라2', 'same'), ('문서 라', 'deleted'), ('문서 바', 'revert'), ('문서 사', 'hidden')$$,
  'afterwards a reverted page reads as already clean, not as a conflict'
);
select results_eq(
  $$select action, page_title, revision_id, note, reason from public.admin_log order by id desc limit 1$$,
  format($$values ('bulk_revert'::text, '문서 가'::text, %s::bigint, '문서 1개 되돌림, 2개 삭제'::text,
                   '여러 문서 훼손'::text)$$, :b1),
  'the bulk revert is recorded once, on the lookup''s source page'
);

-- 미리보기 뒤에 현재 판이 바뀌었으면 건너뛰고, 한 일이 없으면 기록하지 않는다.
select is(
  (select outcome from public.bulk_revert(:'lookup', null,
     jsonb_build_array(jsonb_build_object('page_id', :pm, 'current_revision_id', :am)), '오래된 미리보기')),
  'skipped',
  'a page whose current revision changed since the preview is skipped'
);
select is(
  (select count(*) from public.admin_log where action = 'bulk_revert'), 1::bigint,
  'a run that changed nothing is not recorded'
);

-- 허가가 끝나면 미리보기도 실행도 못 한다.
select logout();
select is(
  (select count(*)::integer from private.reports where revision_id in (:b1, :b3) and resolution = 'handled'), 2,
  'a bulk revert closes the reports on the revisions it removes'
);
update private.author_lookups set expires_at = now() - interval '1 second';
select login(:admin);
select throws_ok(format($$select * from public.preview_bulk_revert(%L)$$, :'lookup'), 'WK016', null,
  'an expired lookup cannot preview');
select throws_ok(
  format($$select * from public.bulk_revert(%L, null, '[{"page_id": 1, "current_revision_id": 1}]', '훼손')$$,
    :'lookup'),
  'WK016', null,
  'an expired lookup cannot run');
select logout();

select * from finish();
rollback;
