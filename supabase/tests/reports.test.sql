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

-- ── 관리자가 보고 닫는다 ─────────────────────────────────────────────────────
select login(:admin);
select is(public.count_open_reports(), 10, 'the admin count is per revision, not per report');
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
select is(public.count_open_reports(), 9, 'the closed revision leaves the count');
select is((select count(*) from public.admin_log), 1::bigint,
  'reports are not in the public log (only the hide above is)');
select logout();

-- 닫힌 뒤에는 같은 판을 다시 신고할 수 있다. 앨리스는 이미 1시간에 10건이라 밥으로 확인한다.
select login(:bob);
select lives_ok(format($$select public.report_revision(%s, 'privacy')$$, :b1),
  'once closed, the same revision can be reported again');
select logout();

select * from finish();
rollback;
