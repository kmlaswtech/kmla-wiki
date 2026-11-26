-- 신고: 회원이 관리자에게만 판을 알린다. 신고자는 누구에게도 드러나지 않는다.
begin;
\ir helpers.inc
select * from no_plan();

select login(:bob);
select page_id as p1, revision_id as b1 from public.save_revision('신고 문서', null, wiki('누군가의 실명')) \gset
select logout();

-- ── 신고하기 ─────────────────────────────────────────────────────────────────
select login(:alice);
select lives_ok(format($$select public.report_revision(%s, 'privacy')$$, :b1),
  'a member can report a revision without a note');
select throws_ok(format($$select public.report_revision(%s, 'abuse', '다시')$$, :b1), 'WK011', null,
  'the same member cannot report the same revision again while it is open');
select throws_ok(format($$select public.report_revision(%s, 'other', ' ')$$, :b1), 'WK014', null,
  '"other" needs a note');
select throws_ok(format($$select public.report_revision(%s, 'spam')$$, :b1), '22023', null,
  'the category must be one of the known ones');
select throws_ok(format($$select public.report_revision(%s, 'abuse', %L)$$, :b1, repeat('가', 301)), 'WK005', null,
  'the note is at most 300 characters');
select throws_ok($$select public.report_revision(999999, 'abuse')$$, 'WK006', null,
  'a missing revision cannot be reported');
select throws_ok($$select * from public.list_open_reports()$$, '42501', null,
  'a member cannot list reports');
select throws_ok($$select public.count_open_reports()$$, '42501', null,
  'a member cannot count reports');
select throws_ok(format($$select public.resolve_reports(%s, 'handled')$$, :b1), '42501', null,
  'a member cannot close reports');
select logout();

select login(:expired);
select throws_ok(format($$select public.report_revision(%s, 'abuse')$$, :b1), '42501', null,
  'a member whose verification expired cannot report');
select logout();

select login(:bob);
select lives_ok(format($$select public.report_revision(%s, 'vandalism', '장난 같음')$$, :b1),
  'another member can report the same revision');
select logout();

-- 1시간에 10건까지. 앨리스는 이미 1건을 했다.
create temp table practice (id bigint) on commit drop;
grant all on practice to authenticated;
select login(:alice);
select page_id as p2 from public.save_revision('신고 연습', null, wiki('하나')) \gset
do $$
declare
  v_base bigint := (select current_revision_id from public.pages where title = '신고 연습');
  v_id bigint;
begin
  for i in 1..10 loop
    select revision_id into v_id from public.save_revision('신고 연습', v_base, public.wiki('판 ' || i));
    insert into practice values (v_id);
    v_base := v_id;
  end loop;
end;
$$;
select lives_ok(
  $$select public.report_revision(id, 'vandalism') from practice order by id limit 9$$,
  'nine more reports fit in the hour');
select throws_ok(
  $$select public.report_revision(id, 'vandalism') from practice order by id desc limit 1$$, 'WK019', null,
  'the eleventh report in an hour is refused');
select logout();

-- 숨긴 판은 신고할 수 없다.
select login(:admin);
select public.set_revision_hidden((select min(id) from practice), true, '연습');
select logout();
select login(:bob);
select throws_ok(format($$select public.report_revision(%s, 'abuse')$$, (select min(id) from practice)), 'WK006', null,
  'a hidden revision cannot be reported');
select logout();
select ok((select resolution = 'handled' from private.reports where revision_id = (select min(id) from practice)),
  'hiding a revision closes its reports');

-- ── 관리자가 보고 닫는다 ─────────────────────────────────────────────────────
select login(:admin);
select is(public.count_open_reports(), 9, 'the admin count is per revision, not per report');
select is((select count(*)::integer from public.list_open_reports()), public.count_open_reports(),
  'the list shows every revision the count includes');
select results_eq(
  format($$select page_title, jsonb_array_length(reports), reports -> 0 ->> 'category', reports -> 1 ->> 'note'
           from public.list_open_reports() where revision_id = %s$$, :b1),
  $$values ('신고 문서'::text, 2, 'privacy'::text, '장난 같음'::text)$$,
  'reports are grouped by revision with their categories and notes'
);
select is_empty(
  $$select 1 from public.list_open_reports() as row, jsonb_array_elements(row.reports) as report
    where report ?| array['reporter_member_id', 'member_id', 'reporter']$$,
  'the list never names the reporter'
);
select is(public.resolve_reports(:b1, 'dismissed'), 2, 'closing a revision closes all its open reports');
select throws_ok(format($$select public.resolve_reports(%s, 'handled')$$, :b1), 'WK011', null,
  'a revision without open reports cannot be closed again');
select throws_ok(format($$select public.resolve_reports(%s, 'maybe')$$, :b1), '22023', null,
  'the resolution must be handled or dismissed');
select is(public.count_open_reports(), 8, 'the closed revision leaves the count');
select is((select count(*) from public.admin_log), 1::bigint,
  'reports are not in the public log (only the hide above is)');
select logout();

-- 기각된 판은 같은 사람이 다시 신고하지 못한다. 다른 사람은 할 수 있고, 관리자는 앞의 기각 수를 본다.
select login(:bob);
select throws_ok(format($$select public.report_revision(%s, 'privacy')$$, :b1), 'WK011', null,
  'a member cannot report a revision again after their report was dismissed');
select logout();
select login(:admin);
select lives_ok(format($$select public.report_revision(%s, 'privacy')$$, :b1),
  'another member can still report a dismissed revision');
select is((select dismissed_count from public.list_open_reports() where revision_id = :b1), 2,
  'the list shows how many reports on the revision were dismissed before');
select public.resolve_reports(:b1, 'handled');
select logout();

-- ── 조치하면 신고가 닫힌다 ───────────────────────────────────────────────────
select login(:bob);
select page_id as p3, revision_id as c1 from public.save_revision('되돌림 신고', null, wiki('처음')) \gset
select revision_id as c2 from public.save_revision('되돌림 신고', :c1, wiki('실명')) \gset
select page_id as p4, revision_id as d1 from public.save_revision('새 신고 문서', null, wiki('실명만')) \gset
select page_id as p5, revision_id as e1 from public.save_revision('삭제 신고 문서', null, wiki('비방')) \gset
select logout();

select login(:admin);
select public.report_revision(id, 'privacy') from unnest(array[:c2, :d1, :e1]::bigint[]) as id;
select throws_ok(format($$select public.revert_and_hide_revision(%s, ' ')$$, :c2), 'WK014', null,
  'reverting and hiding needs a reason');
select lives_ok(format($$select public.revert_and_hide_revision(%s, '실명')$$, :c2),
  'the admin hides the current revision by reverting to the one before');
select lives_ok(format($$select public.revert_and_hide_revision(%s, '실명')$$, :d1),
  'the admin hides the only revision by deleting the page');
select public.delete_page(:p5, '비방');
select logout();

select login(:bob);
select throws_ok(format($$select public.revert_and_hide_revision(%s, '사유')$$, :e1), '42501', null,
  'a member cannot revert and hide');
select logout();

select results_eq(
  format($$select (select body from public.revisions where id = page.current_revision_id)
                    = (select body from public.revisions where id = %s),
                  page.deleted_at is null
           from public.pages as page where page.id = %s$$, :c1, :p3),
  $$values (true, true)$$,
  'the page goes back to the revision before the hidden one'
);
select results_eq(
  format($$select page.deleted_at is not null,
                  (select body from public.revisions where id = page.current_revision_id) = private.empty_doc()
           from public.pages as page where page.id = %s$$, :p4),
  $$values (true, true)$$,
  'a page with no earlier visible revision is deleted with an empty body'
);
select is((select count(*)::integer from public.revisions where id in (:c2, :d1) and hidden_at is not null), 2,
  'both reported revisions are hidden');
select is(
  (select count(*)::integer from private.reports where revision_id in (:c2, :d1, :e1) and resolution = 'handled'),
  3, 'hiding and deleting close the reports as handled'
);
select is(
  (select count(*)::integer from private.reports as report
   join private.members as member on member.id = report.resolved_by_member_id
   where report.revision_id in (:c2, :d1, :e1) and member.is_admin),
  3, 'the admin who acted is recorded as the resolver'
);

-- RPC를 거치지 않고 숨기거나 삭제해도 트리거가 신고를 닫는다.
select login(:bob);
select page_id as p6, revision_id as f1 from public.save_revision('직접 숨김 문서', null, wiki('하나')) \gset
select revision_id as f2 from public.save_revision('직접 숨김 문서', :f1, wiki('둘')) \gset
select page_id as p7, revision_id as g1 from public.save_revision('직접 삭제 문서', null, wiki('하나')) \gset
select logout();
select login(:admin);
select public.report_revision(id, 'privacy') from unnest(array[:f1, :g1]::bigint[]) as id;
select logout();
update public.revisions set hidden_at = now() where id = :f1;
update public.pages set deleted_at = now() where id = :p7;
select is(
  (select count(*)::integer from private.reports
   where revision_id in (:f1, :g1) and resolution = 'handled' and resolved_by_member_id is null),
  2, 'hiding a revision or deleting a page directly closes its reports with no resolver'
);

select * from finish();
rollback;
