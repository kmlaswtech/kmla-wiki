-- 회원 확인과 권한 함수.
begin;
\ir helpers.inc
select * from no_plan();

-- ── 회원 확인이 없으면 아무것도 못 한다 ──────────────────────────────────────
select login(:outsider);
select is(private.can_read(), false, 'a signed-in account without a member row cannot read');
select is(private.can_edit(), false, 'nor edit');
select results_eq(
  $$select is_member, verified, is_admin, banned from public.get_my_status()$$,
  $$values (false, false, false, false)$$,
  'status tells a non-member that they are not a member'
);
select logout();

select login(:expired);
select is(private.can_read(), false, 'an expired verification cannot read');
select results_eq(
  $$select is_member, verified from public.get_my_status()$$,
  $$values (true, false)$$,
  'status tells an expired member that verification has lapsed'
);
select logout();

select login(:alice);
select is(private.can_read(), true, 'a verified member can read');
select is(private.can_edit(), true, 'and edit');
select is(private.is_admin(), false, 'but is not an admin');
select logout();

select login(:admin);
select is(private.is_admin(), true, 'an admin is an admin');
select logout();

-- 관리자도 회원 확인이 지나면 관리자가 아니다.
update private.members set verified_until = now() - interval '1 minute' where kmla_profile_id = 9003;
select login(:admin);
select is(private.is_admin(), false, 'an admin whose verification lapsed loses admin rights');
select results_eq(
  $$select is_admin from public.get_my_status()$$,
  $$values (false)$$,
  'and status agrees'
);
select logout();
update private.members set verified_until = now() + interval '7 days' where kmla_profile_id = 9003;

-- ── 차단은 편집만 막는다 ─────────────────────────────────────────────────────
insert into private.bans (member_id, ends_at, reason)
select id, now() + interval '3 days', '도배' from private.members where kmla_profile_id = 9002;

select login(:bob);
select is(private.can_read(), true, 'a banned member can still read');
select is(private.can_edit(), false, 'but cannot edit');
select results_eq(
  $$select banned, ban_reason from public.get_my_status()$$,
  $$values (true, '도배'::text)$$,
  'status shows the ban and its reason'
);
select logout();

update private.bans set lifted_at = now();
select login(:bob);
select is(private.can_edit(), true, 'a lifted ban no longer blocks editing');
select logout();

insert into private.bans (member_id, starts_at, ends_at, reason)
select id, now() - interval '5 days', now() - interval '1 day', '끝난 차단'
from private.members where kmla_profile_id = 9002;
select login(:bob);
select is(private.can_edit(), true, 'an ended ban no longer blocks editing');
select logout();

-- ── private는 브라우저에서 닿지 않는다 ───────────────────────────────────────
select login(:alice);
select throws_ok(
  $$select * from private.members$$, '42501', null,
  'a member cannot read the members table'
);
select throws_ok(
  $$select * from private.bans$$, '42501', null,
  'nor the bans table'
);
select throws_ok(
  $$select private.current_member_id()$$, '42501', null,
  'nor learn their internal member id'
);
select throws_ok(
  $$select public.record_member_verification('00000000-0000-0000-0000-0000000000a1', 1)$$,
  '42501', null,
  'a browser cannot verify itself'
);
select logout();

-- ── 회원 확인 기록 ───────────────────────────────────────────────────────────
select public.record_member_verification(:outsider, 9100);
select login(:outsider);
select is(private.can_read(), true, 'a recorded verification grants read access');
select logout();

select public.revoke_member_verification(:outsider);
select login(:outsider);
select is(private.can_read(), false, 'a revoked verification removes it immediately');
select logout();

-- 같은 KMLA 회원이 새 위키 계정으로 오면 기존 member를 이어 쓴다. 차단이 유지되는 근거다.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b2', 'bob2@wiki.test');
select public.record_member_verification('00000000-0000-0000-0000-0000000000b2', 9002);
select is(
  (select count(*) from private.members where kmla_profile_id = 9002), 1::bigint,
  'the same KMLA member keeps a single member row across wiki accounts'
);
select is(
  (select auth_user_id from private.members where kmla_profile_id = 9002),
  '00000000-0000-0000-0000-0000000000b2'::uuid,
  'and it now points at the new wiki account'
);

select * from finish();
rollback;
