-- 관리 기능: 차단, 같은 사람의 다른 편집 보기, 보호, 삭제·복구, 판 숨기기, 관리자 지정.
--
-- 원칙
--  * 관리자도 가명 뒤의 신원을 볼 수 없다. 어떤 반환값에도 member·profile 번호를 싣지 않는다.
--  * 대상은 항상 "판"으로 지정한다. 가명은 문서마다 달라 사람을 가리키지 못한다.
--  * 모든 조치는 사유와 함께 공개 기록에 남는다. 기록의 행위자는 "관리자"로만 보이고, 실제로
--    누가 했는지는 private에만 남는다.
--
-- 오류 코드 (앞 마이그레이션의 표에 이어서)
--   WK010  대상이 관리자다(관리자는 차단할 수 없다. 먼저 관리자에서 해제한다)
--   WK011  이미 그 상태다(이미 차단됨, 이미 관리자, 이미 숨김 등)
--   WK012  현재 판은 숨길 수 없다(먼저 되돌린다)
--   WK013  마지막 관리자는 해제할 수 없다
--   WK014  사유가 필요하다

-- ── 공개 기록 ────────────────────────────────────────────────────────────────
create table public.admin_log (
  id bigint generated always as identity primary key,
  action text not null,
  -- 대상 문서의 그때 제목. 문서가 이동·삭제돼도 기록은 읽을 수 있어야 한다.
  page_title text,
  revision_id bigint,
  -- 근거가 된 판의 가명(그 문서에서의). 관리자 지정·해제에는 남기지 않는다.
  pseudonym text,
  reason text not null,
  -- 기간, 보호 등급 같은 덧붙임.
  note text,
  created_at timestamptz not null default now(),
  constraint admin_log_action check (action in (
    'ban', 'lift_ban', 'grant_admin', 'revoke_admin', 'protect', 'unprotect',
    'delete_page', 'restore_page', 'hide_revision', 'unhide_revision', 'view_author_edits'
  ))
);

-- 차단 내역. 근거가 된 문서의 가명으로만 공개한다. 효과는 모든 문서에 미친다.
create table public.ban_log (
  id bigint generated always as identity primary key,
  pseudonym text not null,
  page_title text not null,
  revision_id bigint,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  reason text not null,
  lifted_at timestamptz
);

alter table public.admin_log enable row level security;
alter table public.ban_log enable row level security;
grant select on public.admin_log, public.ban_log to authenticated;

create policy admin_log_select on public.admin_log for select to authenticated
  using ((select private.can_read()));
create policy ban_log_select on public.ban_log for select to authenticated
  using ((select private.can_read()));

-- ── private ──────────────────────────────────────────────────────────────────
-- 누가 한 조치인지. 감사용이고 화면에는 내지 않는다.
create table private.admin_actions (
  admin_log_id bigint primary key references public.admin_log (id) on delete cascade,
  actor_member_id bigint references private.members (id) on delete set null
);
alter table private.admin_actions enable row level security;

alter table private.bans
  add column ban_log_id bigint unique references public.ban_log (id) on delete set null;

-- ── 내부 도우미 ──────────────────────────────────────────────────────────────
create function private.require_admin() returns bigint
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return private.current_member_id();
end;
$$;

create function private.require_reason(p_reason text) returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 2 or char_length(v_reason) > 300 then
    raise exception 'a reason is required' using errcode = 'WK014';
  end if;
  return v_reason;
end;
$$;

create function private.log_admin_action(
  p_action text,
  p_reason text,
  p_page_title text default null,
  p_revision_id bigint default null,
  p_pseudonym text default null,
  p_note text default null
) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_log_id bigint;
begin
  insert into public.admin_log (action, page_title, revision_id, pseudonym, reason, note)
  values (p_action, p_page_title, p_revision_id, p_pseudonym, p_reason, p_note)
  returning id into v_log_id;

  insert into private.admin_actions (admin_log_id, actor_member_id)
  values (v_log_id, private.current_member_id());

  return v_log_id;
end;
$$;

-- 판에서 사람을 찾는다. 이 함수의 결과는 어떤 RPC도 밖으로 돌려주지 않는다.
create function private.revision_target(p_revision_id bigint)
returns table (member_id bigint, pseudonym text, page_id bigint, page_title text)
language sql stable security definer set search_path = ''
as $$
  select author.member_id, revision.author_pseudonym, page.id, page.title
  from public.revisions as revision
  join public.pages as page on page.id = revision.page_id
  join private.revision_authors as author on author.revision_id = revision.id
  where revision.id = p_revision_id;
$$;

revoke all on function private.require_admin() from public;
revoke all on function private.require_reason(text) from public;
revoke all on function private.log_admin_action(text, text, text, bigint, text, text) from public;
revoke all on function private.revision_target(bigint) from public;

-- ── 차단 ─────────────────────────────────────────────────────────────────────
-- 판 작성자를 모든 문서에서 편집 금지한다. `p_days`가 NULL이면 기한 없음.
create function public.ban_editor(p_revision_id bigint, p_days integer, p_reason text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin_id bigint := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_target record;
  v_ends_at timestamptz;
  v_ban_log_id bigint;
begin
  if p_days is not null and (p_days < 1 or p_days > 3650) then
    raise exception 'invalid duration' using errcode = '22023';
  end if;

  select * into v_target from private.revision_target(p_revision_id);
  if v_target.member_id is null then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;
  if exists (select 1 from private.members where id = v_target.member_id and is_admin) then
    raise exception 'target is an admin' using errcode = 'WK010';
  end if;
  if private.member_is_banned(v_target.member_id) then
    raise exception 'already banned' using errcode = 'WK011';
  end if;

  v_ends_at := case when p_days is null then null else now() + make_interval(days => p_days) end;

  insert into public.ban_log (pseudonym, page_title, revision_id, ends_at, reason)
  values (v_target.pseudonym, v_target.page_title, p_revision_id, v_ends_at, v_reason)
  returning id into v_ban_log_id;

  insert into private.bans (member_id, ends_at, reason, created_by_member_id, ban_log_id)
  values (v_target.member_id, v_ends_at, v_reason, v_admin_id, v_ban_log_id);

  perform private.log_admin_action(
    'ban', v_reason, v_target.page_title, p_revision_id, v_target.pseudonym,
    case when p_days is null then '기한 없음' else p_days || '일' end
  );
  return v_ban_log_id;
end;
$$;

create function public.lift_ban(p_ban_log_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin_id bigint := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_log public.ban_log;
begin
  select * into v_log from public.ban_log where id = p_ban_log_id for update;
  if v_log.id is null then
    raise exception 'ban not found' using errcode = 'WK006';
  end if;
  if v_log.lifted_at is not null or (v_log.ends_at is not null and v_log.ends_at <= now()) then
    raise exception 'ban is not active' using errcode = 'WK011';
  end if;

  update public.ban_log set lifted_at = now() where id = p_ban_log_id;
  update private.bans
     set lifted_at = now(), lifted_by_member_id = v_admin_id
   where ban_log_id = p_ban_log_id;

  perform private.log_admin_action(
    'lift_ban', v_reason, v_log.page_title, v_log.revision_id, v_log.pseudonym
  );
end;
$$;

-- ── 같은 사람의 다른 편집 ────────────────────────────────────────────────────
-- 여러 문서에 걸친 훼손을 찾기 위한 것이다. 문서별 가명이 지키는 것을 관리자에게 한해 푸는
-- 기능이라, 볼 때마다 사유와 함께 공개 기록에 남긴다(첫 쪽을 볼 때 한 번).
create function public.list_author_edits(
  p_revision_id bigint,
  p_reason text,
  p_before_revision_id bigint default null
)
returns table (
  revision_id bigint,
  page_title text,
  pseudonym text,
  kind text,
  summary text,
  byte_delta integer,
  created_at timestamptz,
  parent_revision_id bigint,
  is_current boolean,
  hidden_at timestamptz,
  page_deleted boolean
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_target record;
begin
  perform private.require_admin();

  select * into v_target from private.revision_target(p_revision_id);
  if v_target.member_id is null then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;

  if p_before_revision_id is null then
    perform private.log_admin_action(
      'view_author_edits', private.require_reason(p_reason),
      v_target.page_title, p_revision_id, v_target.pseudonym
    );
  end if;

  return query
  select
    revision.id, page.title, revision.author_pseudonym, revision.kind, revision.summary,
    revision.byte_delta, revision.created_at, revision.parent_revision_id,
    revision.id = page.current_revision_id, revision.hidden_at, page.deleted_at is not null
  from private.revision_authors as author
  join public.revisions as revision on revision.id = author.revision_id
  join public.pages as page on page.id = revision.page_id
  where author.member_id = v_target.member_id
    and (p_before_revision_id is null or revision.id < p_before_revision_id)
  order by revision.id desc
  limit 50;
end;
$$;

-- ── 보호, 삭제, 복구 ─────────────────────────────────────────────────────────
create function public.set_protection(p_page_id bigint, p_level text, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_page public.pages;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);
  if p_level not in ('open', 'admin') then
    raise exception 'invalid protection level' using errcode = '22023';
  end if;

  select * into v_page from public.pages where id = p_page_id for update;
  if v_page.id is null then
    raise exception 'page not found' using errcode = 'WK006';
  end if;
  if v_page.protection = p_level then
    raise exception 'already at that level' using errcode = 'WK011';
  end if;

  update public.pages set protection = p_level where id = p_page_id;
  perform private.log_admin_action(
    case when p_level = 'admin' then 'protect' else 'unprotect' end, v_reason, v_page.title
  );
end;
$$;

-- 삭제는 숨기는 것이다. 판 기록은 남고 관리자가 복구할 수 있다. 일반 사용자에게는 문서와 판이
-- 모두 보이지 않는다.
create function public.delete_page(p_page_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin_id bigint := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_page public.pages;
  v_body jsonb;
begin
  select * into v_page from public.pages where id = p_page_id for update;
  if v_page.id is null then
    raise exception 'page not found' using errcode = 'WK006';
  end if;
  if v_page.deleted_at is not null then
    raise exception 'already deleted' using errcode = 'WK011';
  end if;

  select body into v_body from public.revisions where id = v_page.current_revision_id;
  perform private.write_revision(p_page_id, v_admin_id, coalesce(v_body, private.empty_doc()), v_reason, 'delete', true);
  update public.pages set deleted_at = now() where id = p_page_id;
  perform private.log_admin_action('delete_page', v_reason, v_page.title);
end;
$$;

create function public.restore_page(p_page_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_admin_id bigint := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_page public.pages;
  v_body jsonb;
begin
  select * into v_page from public.pages where id = p_page_id for update;
  if v_page.id is null then
    raise exception 'page not found' using errcode = 'WK006';
  end if;
  if v_page.deleted_at is null then
    raise exception 'not deleted' using errcode = 'WK011';
  end if;

  update public.pages set deleted_at = null where id = p_page_id;
  select body into v_body from public.revisions where id = v_page.current_revision_id;
  perform private.write_revision(p_page_id, v_admin_id, coalesce(v_body, private.empty_doc()), v_reason, 'restore', true);
  perform private.log_admin_action('restore_page', v_reason, v_page.title);
end;
$$;

-- ── 판 숨기기 ────────────────────────────────────────────────────────────────
-- 되돌려도 판 기록에는 원문이 남는다. 실명이 나오는 사건, 비방, 개인정보처럼 남아 있으면 안 되는
-- 내용은 판을 숨긴다. 현재 판은 숨길 수 없다(먼저 되돌려서 예전 판으로 만든다).
create function public.set_revision_hidden(p_revision_id bigint, p_hidden boolean, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_revision public.revisions;
  v_page public.pages;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);

  select * into v_revision from public.revisions where id = p_revision_id for update;
  if v_revision.id is null then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;
  select * into v_page from public.pages where id = v_revision.page_id;

  if (v_revision.hidden_at is not null) = p_hidden then
    raise exception 'already in that state' using errcode = 'WK011';
  end if;
  if p_hidden and v_page.current_revision_id = p_revision_id then
    raise exception 'cannot hide the current revision' using errcode = 'WK012';
  end if;

  update public.revisions
     set hidden_at = case when p_hidden then now() end
   where id = p_revision_id;
  perform private.log_admin_action(
    case when p_hidden then 'hide_revision' else 'unhide_revision' end,
    v_reason, v_page.title, p_revision_id, v_revision.author_pseudonym
  );
end;
$$;

-- ── 관리자 지정·해제 ─────────────────────────────────────────────────────────
-- 지정은 판 작성자 기준, 해제는 관리자 전용 이름 기준이다. 최초 1명만 SQL로 지정한다.
create function private.next_admin_handle() returns text
language sql stable security definer set search_path = ''
as $$
  -- 관리자 A, B, … Z, 그다음은 번호.
  select coalesce(
    (
      select '관리자 ' || chr(code)
      from generate_series(ascii('A'), ascii('Z')) as code
      where not exists (
        select 1 from private.members where admin_handle = '관리자 ' || chr(code)
      )
      order by code
      limit 1
    ),
    '관리자 ' || (select count(*) + 1 from private.members where is_admin)
  );
$$;
revoke all on function private.next_admin_handle() from public;

create function public.grant_admin(p_revision_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_target record;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);

  select * into v_target from private.revision_target(p_revision_id);
  if v_target.member_id is null then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;
  if exists (select 1 from private.members where id = v_target.member_id and is_admin) then
    raise exception 'already an admin' using errcode = 'WK011';
  end if;
  if private.member_is_banned(v_target.member_id) then
    raise exception 'target is banned' using errcode = 'WK002';
  end if;

  update private.members
     set is_admin = true, admin_handle = private.next_admin_handle()
   where id = v_target.member_id;

  -- 누구를 지정했는지는 공개하지 않는다. 가명과 문서를 남기면 그 가명이 관리자라는 것이 드러난다.
  perform private.log_admin_action('grant_admin', v_reason);
end;
$$;

create function public.revoke_admin(p_admin_handle text, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_member_id bigint;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);

  -- 동시에 서로를 해제해 관리자가 0명이 되는 일을 막는다.
  perform 1 from private.members where is_admin for update;

  select id into v_member_id from private.members
  where admin_handle = p_admin_handle and is_admin;
  if v_member_id is null then
    raise exception 'admin not found' using errcode = 'WK006';
  end if;
  if (select count(*) from private.members where is_admin) <= 1 then
    raise exception 'cannot revoke the last admin' using errcode = 'WK013';
  end if;

  update private.members set is_admin = false, admin_handle = null where id = v_member_id;
  perform private.log_admin_action('revoke_admin', v_reason);
end;
$$;

-- 관리자 목록. 관리자 전용 이름만 돌려준다.
create function public.list_admins()
returns table (admin_handle text, is_me boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select member.admin_handle, member.id = private.current_member_id()
  from private.members as member
  where member.is_admin
  order by member.admin_handle;
end;
$$;

-- 일반 사용자에게는 "관리자 N명"만 보인다.
create function public.admin_count() returns integer
language sql stable security definer set search_path = ''
as $$
  select case when private.can_read()
    then (select count(*)::integer from private.members where is_admin)
  end;
$$;

revoke all on function public.ban_editor(bigint, integer, text) from public, anon;
revoke all on function public.lift_ban(bigint, text) from public, anon;
revoke all on function public.list_author_edits(bigint, text, bigint) from public, anon;
revoke all on function public.set_protection(bigint, text, text) from public, anon;
revoke all on function public.delete_page(bigint, text) from public, anon;
revoke all on function public.restore_page(bigint, text) from public, anon;
revoke all on function public.set_revision_hidden(bigint, boolean, text) from public, anon;
revoke all on function public.grant_admin(bigint, text) from public, anon;
revoke all on function public.revoke_admin(text, text) from public, anon;
revoke all on function public.list_admins() from public, anon;
revoke all on function public.admin_count() from public, anon;

-- 관리자 여부는 함수 안에서 검사한다. 실행 권한은 로그인한 사용자 전체에 준다.
grant execute on function public.ban_editor(bigint, integer, text) to authenticated;
grant execute on function public.lift_ban(bigint, text) to authenticated;
grant execute on function public.list_author_edits(bigint, text, bigint) to authenticated;
grant execute on function public.set_protection(bigint, text, text) to authenticated;
grant execute on function public.delete_page(bigint, text) to authenticated;
grant execute on function public.restore_page(bigint, text) to authenticated;
grant execute on function public.set_revision_hidden(bigint, boolean, text) to authenticated;
grant execute on function public.grant_admin(bigint, text) to authenticated;
grant execute on function public.revoke_admin(text, text) to authenticated;
grant execute on function public.list_admins() to authenticated;
grant execute on function public.admin_count() to authenticated;
