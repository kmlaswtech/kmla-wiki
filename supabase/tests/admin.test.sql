-- 관리 기능: 관리자만 쓸 수 있고, 신원을 드러내지 않고, 모든 조치가 기록에 남는다.
begin;
\ir helpers.inc
select * from no_plan();

-- 준비: 밥이 두 문서를 고치고, 앨리스가 한 문서를 고친다.
select login(:bob);
select page_id as p1, revision_id as b1 from public.save_revision('훼손 문서 하나', null, wiki('원래 내용')) \gset
select page_id as p2, revision_id as b2 from public.save_revision('훼손 문서 둘', null, wiki('원래 내용')) \gset
select logout();
select login(:alice);
select revision_id as a1 from public.save_revision('훼손 문서 하나', :b1, wiki('앨리스가 고침')) \gset
select logout();

-- ── 일반 사용자는 관리 기능을 쓸 수 없다 ─────────────────────────────────────
select login(:alice);
select throws_ok(format($$select public.ban_editor(%s, interval '7 days', '도배')$$, :b1), '42501', null,
  'a member cannot ban');
select throws_ok(format($$select public.open_author_lookup(%s, '확인')$$, :b1), '42501', null,
  'a member cannot open a lookup of another author''s edits');
select throws_ok(format($$select public.find_author_lookup(%s)$$, :b1), '42501', null,
  'a member cannot look for an open lookup');
select throws_ok($$select * from public.list_my_author_lookups()$$, '42501', null,
  'a member cannot list lookups');
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
select throws_ok($$select public.set_admin_nickname('밥')$$, '42501', null,
  'a member cannot set an admin nickname');
select is(public.admin_count(), 1, 'a member only learns how many admins there are');
select logout();

-- ── 같은 사람의 다른 편집 ────────────────────────────────────────────────────
select login(:admin);
select throws_ok(format($$select public.open_author_lookup(%s, ' ')$$, :b1), 'WK014', null,
  'opening a lookup requires a reason');
select open_author_lookup as lookup1 from public.open_author_lookup(:b1, '여러 문서 훼손 확인') \gset
select set_eq(
  format($$select revision_id from public.list_author_edits(%L)$$, :'lookup1'),
  format($$values (%s::bigint), (%s::bigint)$$, :b1, :b2),
  'an admin sees the same author''s edits across pages, and nobody else''s'
);
select results_eq(
  format($$select source_revision_id, page_title, pseudonym from public.get_author_lookup(%L)$$, :'lookup1'),
  format($$select id, '훼손 문서 하나'::text, author_pseudonym from public.revisions where id = %s$$, :b1),
  'the lookup remembers the revision it started from, with its page and pseudonym'
);
select is(
  (select count(*) from public.list_author_edits(:'lookup1', null, 1)), 1::bigint,
  'a caller can read fewer rows at once'
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
  format($$select * from public.list_author_edits(%L, %s)$$, :'lookup1', :b2),
  'paging further does not need the reason again');
select is(
  public.open_author_lookup(:b2, '다른 판에서 다시 조회'), :'lookup1'::uuid,
  'opening again for the same author within the window reuses the lookup'
);
select is(
  (select count(*) from public.admin_log where action = 'view_author_edits'), 1::bigint,
  'and nothing more is recorded'
);
select is(
  public.find_author_lookup(:b2), :'lookup1'::uuid,
  'the open lookup is found from any revision by the same author, without a reason'
);
select is(public.find_author_lookup(:a1), null::uuid, 'but not from another author''s revision');
select is(
  (select count(*) from public.admin_log where action = 'view_author_edits'), 1::bigint,
  'finding a lookup records nothing'
);
select results_eq(
  $$select lookup_id, page_title from public.list_my_author_lookups()$$,
  format($$values (%L::uuid, '훼손 문서 하나'::text)$$, :'lookup1'),
  'an admin lists their own open lookups'
);
select throws_ok(
  format($$select * from public.list_author_edits(%L)$$, gen_random_uuid()), 'WK016', null,
  'an unknown lookup cannot be read');
select throws_ok(
  $$select * from public.get_author_lookup('not-a-uuid')$$, 'WK016', null,
  'a malformed lookup id reads as an expired lookup');
select logout();
update private.author_lookups set expires_at = now() + interval '1 minute' where id = :'lookup1';
select login(:admin);
select isnt(
  public.open_author_lookup(:b2, '곧 끝나서 새로 조회'), :'lookup1'::uuid,
  'a lookup about to expire is not reused; a new one is opened'
);
select is(
  (select count(*) from public.admin_log where action = 'view_author_edits'), 2::bigint,
  'and the new lookup is recorded with its own reason'
);
select logout();
update private.author_lookups set expires_at = now() - interval '1 second' where id = :'lookup1';
select login(:admin);
select throws_ok(
  format($$select * from public.list_author_edits(%L)$$, :'lookup1'), 'WK016', null,
  'an expired lookup cannot be read');
select logout();

-- 다른 관리자의 허가는 쓸 수 없다. 앨리스를 잠시 관리자로 만들어 확인한다.
update private.members set is_admin = true, admin_handle = '관리자 Z' where auth_user_id = :alice;
select login(:admin);
select open_author_lookup as lookup2 from public.open_author_lookup(:b1, '다시 확인') \gset
select logout();
select login(:alice);
select throws_ok(
  format($$select * from public.list_author_edits(%L)$$, :'lookup2'), 'WK016', null,
  'one admin cannot use another admin''s lookup');
select logout();
update private.members set is_admin = false, admin_handle = null where auth_user_id = :alice;
select login(:admin);

-- ── 차단 ─────────────────────────────────────────────────────────────────────
select throws_ok(format($$select public.ban_editor(%s, interval '7 days', '')$$, :b1), 'WK014', null,
  'a ban requires a reason');
select ban_editor as ban1 from public.ban_editor(:b1, interval '7 days', '여러 문서 훼손') \gset
select throws_ok(format($$select public.ban_editor(%s, interval '7 days', '또 차단')$$, :b2), 'WK011', null,
  'an already banned author cannot be banned again');
select results_eq(
  format($$select pseudonym, page_title, reason, lifted_at is null from public.ban_log where id = %s$$, :ban1),
  format($$select author_pseudonym, '훼손 문서 하나'::text, '여러 문서 훼손'::text, true
           from public.revisions where id = %s$$, :b1),
  'the public ban log shows only the pseudonym on the source page'
);
select throws_ok(
  format($$select public.change_ban_end(%s, interval '30 minutes', '짧게')$$, :ban1), 'WK017', null,
  'a ban is at least an hour');
select throws_ok(
  format($$select public.change_ban_end(%s, interval '11 years', '길게')$$, :ban1), 'WK017', null,
  'a ban cannot end more than ten years ahead');
select lives_ok(
  format($$select public.change_ban_end(%s, interval '3 hours', '줄임')$$, :ban1),
  'an admin shortens an active ban');
select logout();
select ok(
  (select ends_at < now() + interval '4 hours' from public.ban_log where id = :ban1)
  and (select ends_at < now() + interval '4 hours' from private.bans where ban_log_id = :ban1),
  'the public log and the private ban both get the new end');
select login(:admin);
select lives_ok(
  format($$select public.change_ban_end(%s, null, '무기한으로')$$, :ban1),
  'an admin makes a ban indefinite');
select throws_ok(
  format($$select public.change_ban_end(%s, null, '또 무기한')$$, :ban1), 'WK011', null,
  'changing to the same end is rejected');
select results_eq(
  $$select note ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}까지$', note = '기한 없음'
    from public.admin_log where action = 'change_ban' order by id$$,
  $$values (true, false), (false, true)$$,
  'each change is recorded publicly with the new end'
);
select logout();

select login(:bob);
select throws_ok(
  format($$select * from public.save_revision('훼손 문서 둘', %s, wiki('차단 뒤 편집'))$$, :b2), 'WK002', null,
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
  format($$select * from public.save_revision('훼손 문서 둘', %s, wiki('해제 뒤 편집'))$$, :b2),
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
select throws_ok(format($$select public.ban_editor(%s, interval '7 days', '관리자 차단')$$, :a1), 'WK010', null,
  'an admin cannot be banned');
select logout();

select login(:alice);
select is(private.is_admin(), true, 'the granted member is now an admin');
select lives_ok($$select public.revoke_admin('관리자 A', '교대')$$, 'one admin can revoke another');
select throws_ok($$select public.revoke_admin('관리자 B', '나까지')$$, 'WK013', null,
  'but not themselves when they are the last one');
select logout();

-- ── 해제 되돌리기 ────────────────────────────────────────────────────────────
select login(:bob);
select throws_ok($$select * from public.list_restorable_revocations()$$, '42501', null,
  'a member cannot list revocations');
select throws_ok($$select public.restore_revoked_admin(1, '복구')$$, '42501', null,
  'a member cannot restore an admin');
select logout();

select login(:alice);
select id as revoke_log from public.admin_log where action = 'revoke_admin' \gset
select results_eq(
  $$select admin_log_id, admin_handle, reason from public.list_restorable_revocations()$$,
  format($$values (%s::bigint, '관리자 A'::text, '교대'::text)$$, :revoke_log),
  'an admin sees the recent revocation by handle and public log id'
);
select logout();
select is(private.next_admin_handle(), '관리자 C', 'a restorable handle is not given to a new admin');
select login(:alice);
select lives_ok(format($$select public.restore_revoked_admin(%s, '실수로 해제')$$, :revoke_log),
  'an admin restores a recent revocation');
select set_eq(
  $$select admin_handle from public.list_admins()$$,
  array['관리자 A', '관리자 B'],
  'the same member is back under the same handle'
);
select throws_ok(format($$select public.restore_revoked_admin(%s, '다시')$$, :revoke_log), 'WK011', null,
  'a revocation is restored only once');
select is_empty($$select 1 from public.list_restorable_revocations()$$,
  'a restored revocation leaves the list');
select results_eq(
  $$select page_title, revision_id, pseudonym, note from public.admin_log where action = 'restore_admin'$$,
  format($$values (null::text, null::bigint, null::text, '기록 #%s'::text)$$, :revoke_log),
  'the restore is public but names only the revocation, not the member'
);
select logout();

-- ── 관리자 별명 ──────────────────────────────────────────────────────────────
select login(:admin);
select lives_ok($$select public.set_admin_nickname('  운영 담당  ')$$, 'an admin sets their own nickname');
select logout();
select login(:alice);
select throws_ok(format($$select public.set_admin_nickname(%L)$$, repeat('가', 21)), 'WK021', null,
  'a nickname is at most 20 characters');
select throws_ok($$select public.set_admin_nickname('줄' || chr(10) || '바꿈')$$, 'WK021', null,
  'a nickname has no control characters');
select lives_ok($$select public.set_admin_nickname('운영 담당')$$, 'nicknames may be the same');
select lives_ok($$select public.set_admin_nickname('   ')$$, 'a blank nickname clears it');
select results_eq(
  $$select admin_handle, admin_nickname, is_me from public.list_admins() order by admin_handle$$,
  $$values ('관리자 A'::text, '운영 담당'::text, false), ('관리자 B', null, true)$$,
  'admins see each other''s trimmed nicknames'
);
select is_empty(
  $$select 1 from public.admin_log where coalesce(note, '') || coalesce(reason, '') like '%운영 담당%'$$,
  'a nickname is not written to the public log'
);

-- 관리자 A에게 별명이 있으므로, 해제가 통과하면 별명도 지운 것이다(`members_admin_nickname_shape`).
select lives_ok($$select public.revoke_admin('관리자 A', '다시 교대')$$, 'the admin with a nickname can be revoked again');
select id as second_revoke from public.admin_log where action = 'revoke_admin' order by id desc limit 1 \gset
select logout();
update public.admin_log set created_at = now() - interval '8 days' where id = :second_revoke;
select login(:alice);
select throws_ok(format($$select public.restore_revoked_admin(%s, '늦게')$$, :second_revoke), 'WK020', null,
  'a revocation older than the window cannot be restored');
select is_empty($$select 1 from public.list_restorable_revocations()$$,
  'an expired revocation leaves the list');
select logout();
select is(private.next_admin_handle(), '관리자 A', 'an expired revocation frees its handle');

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
