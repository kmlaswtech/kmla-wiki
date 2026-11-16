-- 관리 기능: 관리자만 쓸 수 있고, 신원을 드러내지 않고, 모든 조치가 기록에 남는다.
begin;
\ir helpers.inc
select * from no_plan();

-- 준비: 밥이 두 문서를 고치고, 앨리스가 한 문서를 고친다.
select login(:bob);
select page_id as p1, revision_id as b1 from public.save_revision('훼손 문서 하나', null, '원래 내용') \gset
select page_id as p2, revision_id as b2 from public.save_revision('훼손 문서 둘', null, '원래 내용') \gset
select logout();
select login(:alice);
select revision_id as a1 from public.save_revision('훼손 문서 하나', :b1, '앨리스가 고침') \gset
select logout();

-- ── 일반 사용자는 관리 기능을 쓸 수 없다 ─────────────────────────────────────
select login(:alice);
select throws_ok(format($$select public.ban_editor(%s, 7, '도배')$$, :b1), '42501', null,
  'a member cannot ban');
select throws_ok(format($$select * from public.list_author_edits(%s, '확인')$$, :b1), '42501', null,
  'a member cannot list another author''s edits');
select throws_ok(format($$select public.set_protection(%s, 'admin', '보호')$$, :p1), '42501', null,
  'a member cannot protect a page');
select throws_ok(format($$select public.delete_page(%s, '삭제')$$, :p1), '42501', null,
  'a member cannot delete a page');
select throws_ok(format($$select public.set_revision_hidden(%s, true, '숨김')$$, :b1), '42501', null,
  'a member cannot hide a revision');
select throws_ok(format($$select public.grant_admin(%s, '지정')$$, :b1), '42501', null,
  'a member cannot grant admin');
select throws_ok($$select public.revoke_admin('관리자 A', '해제')$$, '42501', null,
  'a member cannot revoke admin');
select throws_ok($$select * from public.list_admins()$$, '42501', null,
  'a member cannot list admins');
select is(public.admin_count(), 1, 'a member only learns how many admins there are');
select logout();

-- ── 같은 사람의 다른 편집 ────────────────────────────────────────────────────
select login(:admin);
select throws_ok(format($$select * from public.list_author_edits(%s, ' ')$$, :b1), 'WK014', null,
  'listing an author''s edits requires a reason');
select set_eq(
  format($$select revision_id from public.list_author_edits(%s, '여러 문서 훼손 확인')$$, :b1),
  format($$values (%s::bigint), (%s::bigint)$$, :b1, :b2),
  'an admin sees the same author''s edits across pages, and nobody else''s'
);
select results_eq(
  $$select action, page_title, pseudonym, reason from public.admin_log order by id desc limit 1$$,
  format(
    $$select 'view_author_edits'::text, '훼손 문서 하나'::text, author_pseudonym, '여러 문서 훼손 확인'::text
      from public.revisions where id = %s$$, :b1),
  'the lookup is recorded publicly with the pseudonym on the source page'
);
select is(
  (select count(*) from public.admin_log where action = 'view_author_edits'), 1::bigint,
  'the failed attempt without a reason was not recorded'
);
select lives_ok(
  format($$select * from public.list_author_edits(%s, null, %s)$$, :b1, :b2),
  'paging further does not need the reason again');
select is(
  (select count(*) from public.admin_log where action = 'view_author_edits'), 1::bigint,
  'and is not recorded a second time'
);

-- ── 차단 ─────────────────────────────────────────────────────────────────────
select throws_ok(format($$select public.ban_editor(%s, 7, '')$$, :b1), 'WK014', null,
  'a ban requires a reason');
select ban_editor as ban1 from public.ban_editor(:b1, 7, '여러 문서 훼손') \gset
select throws_ok(format($$select public.ban_editor(%s, 7, '또 차단')$$, :b2), 'WK011', null,
  'an already banned author cannot be banned again');
select results_eq(
  format($$select pseudonym, page_title, reason, lifted_at is null from public.ban_log where id = %s$$, :ban1),
  format($$select author_pseudonym, '훼손 문서 하나'::text, '여러 문서 훼손'::text, true
           from public.revisions where id = %s$$, :b1),
  'the public ban log shows only the pseudonym on the source page'
);
select logout();

select login(:bob);
select throws_ok(
  format($$select * from public.save_revision('훼손 문서 둘', %s, '차단 뒤 편집')$$, :b2), 'WK002', null,
  'the ban applies on every page, not only the source page');
select isnt_empty($$select 1 from public.pages$$, 'a banned member still reads');
select logout();

select login(:admin);
select lives_ok(format($$select public.lift_ban(%s, '오해였음')$$, :ban1), 'an admin lifts the ban');
select throws_ok(format($$select public.lift_ban(%s, '또 해제')$$, :ban1), 'WK011', null,
  'a lifted ban cannot be lifted again');
select logout();
select login(:bob);
select lives_ok(
  format($$select * from public.save_revision('훼손 문서 둘', %s, '해제 뒤 편집')$$, :b2),
  'editing works again after the ban is lifted');
select logout();

-- ── 보호, 삭제, 복구 ─────────────────────────────────────────────────────────
select login(:admin);
select lives_ok(format($$select public.set_protection(%s, 'admin', '대문')$$, :p1), 'an admin protects a page');
select throws_ok(format($$select public.set_protection(%s, 'admin', '다시 보호')$$, :p1), 'WK011', null,
  'protecting twice is rejected');
select lives_ok(format($$select public.delete_page(%s, '사람 문서')$$, :p2), 'an admin deletes a page');
select results_eq(
  format($$select kind, author_pseudonym, summary from public.revisions
           where page_id = %s order by id desc limit 1$$, :p2),
  $$values ('delete'::text, '관리자'::text, '사람 문서'::text)$$,
  'deletion is recorded in the page history as an admin action, not under a pseudonym'
);
select logout();

select login(:alice);
select is_empty(format($$select 1 from public.pages where id = %s$$, :p2),
  'a deleted page disappears for members');
select logout();

select login(:admin);
select lives_ok(format($$select public.restore_page(%s, '잘못 삭제')$$, :p2), 'an admin restores it');
select logout();
select login(:alice);
select isnt_empty(format($$select 1 from public.pages where id = %s$$, :p2),
  'a restored page is visible again');
select logout();

-- ── 판 숨기기 ────────────────────────────────────────────────────────────────
select login(:admin);
select throws_ok(format($$select public.set_revision_hidden(%s, true, '현재 판')$$, :a1), 'WK012', null,
  'the current revision cannot be hidden');
select lives_ok(format($$select public.set_revision_hidden(%s, true, '실명 사건')$$, :b1),
  'an admin hides an old revision');
select logout();
select login(:alice);
select is_empty(format($$select 1 from public.revisions where id = %s$$, :b1),
  'a hidden revision disappears for members');
select isnt_empty(
  $$select 1 from public.admin_log where action = 'hide_revision' and reason = '실명 사건'$$,
  'but the fact that it was hidden, and why, is public');
select logout();

-- ── 관리자 지정·해제 ─────────────────────────────────────────────────────────
select login(:admin);
select throws_ok($$select public.revoke_admin('관리자 A', '혼자 남음')$$, 'WK013', null,
  'the last admin cannot be revoked');
select lives_ok(format($$select public.grant_admin(%s, '운영 도움')$$, :a1), 'an admin grants admin by a revision');
select throws_ok(format($$select public.grant_admin(%s, '다시 지정')$$, :a1), 'WK011', null,
  'granting twice is rejected');
select set_eq(
  $$select admin_handle from public.list_admins()$$,
  array['관리자 A', '관리자 B'],
  'admins are listed by handle only'
);
select results_eq(
  $$select page_title, pseudonym from public.admin_log where action = 'grant_admin'$$,
  $$values (null::text, null::text)$$,
  'the grant is public but does not reveal which pseudonym became an admin'
);
select throws_ok(format($$select public.ban_editor(%s, 7, '관리자 차단')$$, :a1), 'WK010', null,
  'an admin cannot be banned');
select logout();

select login(:alice);
select is(private.is_admin(), true, 'the granted member is now an admin');
select lives_ok($$select public.revoke_admin('관리자 A', '교대')$$, 'one admin can revoke another');
select throws_ok($$select public.revoke_admin('관리자 B', '나까지')$$, 'WK013', null,
  'but not themselves when they are the last one');
select logout();

-- ── 기록에는 행위자가 없다 ───────────────────────────────────────────────────
select is_empty(
  $$select 1 from information_schema.columns
    where table_schema = 'public' and table_name in ('admin_log', 'ban_log')
      and column_name ~ '(actor|admin|member|created_by)'$$,
  'the public logs have no column that identifies who acted'
);
select is(
  (select count(*) from private.admin_actions where actor_member_id is not null),
  (select count(*) from public.admin_log),
  'every public log entry has a private record of who acted'
);

select * from finish();
rollback;
