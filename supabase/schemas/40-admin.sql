-- 선언적 스키마 정본. 이 파일을 먼저 고치고 `pnpm db:diff <이름>`으로 migration 초안을 만든 뒤 검토한다.
--
-- 관리자, 차단, 보호, 판 숨김, 관리 기록.

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION private.log_admin_action (
  p_action      text,
  p_reason      text,
  p_page_title  text   DEFAULT NULL::text,
  p_revision_id bigint DEFAULT NULL::bigint,
  p_pseudonym   text   DEFAULT NULL::text,
  p_note        text   DEFAULT NULL::text
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "private"."log_admin_action"(text, text, text, bigint, text, text) FROM PUBLIC;

-- ── 관리자 지정·해제 ─────────────────────────────────────────────────────────
-- 지정은 판 작성자 기준, 해제는 관리자 전용 이름 기준이다. 최초 1명만 SQL로 지정한다.
CREATE OR REPLACE FUNCTION private.next_admin_handle()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "private"."next_admin_handle"() FROM PUBLIC;

-- ── 내부 도우미 ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.require_admin()
  RETURNS bigint
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return private.current_member_id();
end;
$function$;

REVOKE ALL ON FUNCTION "private"."require_admin"() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.require_reason (
  p_reason text
)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 2 or char_length(v_reason) > 300 then
    raise exception 'a reason is required' using errcode = 'WK014';
  end if;
  return v_reason;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."require_reason"(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.revision_target (
  p_revision_id bigint
)
  RETURNS TABLE (
    member_id  bigint,
    pseudonym  text,
    page_id    bigint,
    page_title text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select author.member_id, revision.author_pseudonym, page.id, page.title
  from public.revisions as revision
  join public.pages as page on page.id = revision.page_id
  join private.revision_authors as author on author.revision_id = revision.id
  where revision.id = p_revision_id;
$function$;

REVOKE ALL ON FUNCTION "private"."revision_target"(bigint) FROM PUBLIC;

-- 차단이 끝나는 시각. NULL은 기한 없음이다. 너무 짧은 값은 시계 차이로 이미 지났을 수 있어 막는다.
CREATE OR REPLACE FUNCTION private.check_ban_end (
  p_ends_at timestamptz
)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
begin
  if p_ends_at is not null
     and (p_ends_at < now() + interval '5 minutes' or p_ends_at > now() + interval '10 years') then
    raise exception 'invalid duration' using errcode = '22023';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."check_ban_end"(timestamp with time zone) FROM PUBLIC;

-- 공개 기록의 덧붙임. 학교 시간(KST)으로 적는다.
CREATE OR REPLACE FUNCTION private.ban_end_note (
  p_ends_at timestamptz
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select case
    when p_ends_at is null then '기한 없음'
    else to_char(p_ends_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || '까지'
  end;
$function$;

REVOKE ALL ON FUNCTION "private"."ban_end_note"(timestamp with time zone) FROM PUBLIC;

-- 관리자 본인이 연, 아직 유효한 조회 허가의 대상. 없거나 끝났으면 WK016.
CREATE OR REPLACE FUNCTION private.author_lookup_target (
  p_lookup_id uuid
)
  RETURNS bigint
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_target_id bigint;
begin
  select lookup.target_member_id into v_target_id
  from private.author_lookups as lookup
  where lookup.id = p_lookup_id
    and lookup.admin_member_id = private.current_member_id()
    and lookup.expires_at > now();
  if v_target_id is null then
    raise exception 'lookup expired' using errcode = 'WK016';
  end if;
  return v_target_id;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."author_lookup_target"(uuid) FROM PUBLIC;

-- 일반 사용자에게는 "관리자 N명"만 보인다.
CREATE OR REPLACE FUNCTION public.admin_count()
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select case when private.can_read()
    then (select count(*)::integer from private.members where is_admin)
  end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."admin_count"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."admin_count"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_count"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_count"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_count"() FROM PUBLIC, "anon";

-- `p_ends_at`이 NULL이면 기한 없음. 기간 계산(시간, 일, 개월)은 화면이 하고, 서버는 범위만 본다.
CREATE OR REPLACE FUNCTION public.ban_editor (
  p_revision_id bigint,
  p_ends_at     timestamp with time zone,
  p_reason      text
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_admin_id bigint := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_target record;
  v_ban_log_id bigint;
begin
  perform private.check_ban_end(p_ends_at);

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

  insert into public.ban_log (pseudonym, page_title, revision_id, ends_at, reason)
  values (v_target.pseudonym, v_target.page_title, p_revision_id, p_ends_at, v_reason)
  returning id into v_ban_log_id;

  insert into private.bans (member_id, ends_at, reason, created_by_member_id, ban_log_id)
  values (v_target.member_id, p_ends_at, v_reason, v_admin_id, v_ban_log_id);

  perform private.log_admin_action(
    'ban', v_reason, v_target.page_title, p_revision_id, v_target.pseudonym,
    private.ban_end_note(p_ends_at)
  );
  return v_ban_log_id;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."ban_editor"(bigint, timestamp with time zone, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."ban_editor"(bigint, timestamp with time zone, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."ban_editor"(bigint, timestamp with time zone, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ban_editor"(bigint, timestamp with time zone, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."ban_editor"(bigint, timestamp with time zone, text) FROM PUBLIC, "anon";

-- 진행 중인 차단의 끝나는 시각을 바꾼다(연장, 단축, 기한 없음으로). 해제했다 다시 차단하지 않아도 된다.
CREATE OR REPLACE FUNCTION public.change_ban_end (
  p_ban_log_id bigint,
  p_ends_at    timestamp with time zone,
  p_reason     text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_reason text;
  v_log public.ban_log;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);
  perform private.check_ban_end(p_ends_at);

  select * into v_log from public.ban_log where id = p_ban_log_id for update;
  if v_log.id is null then
    raise exception 'ban not found' using errcode = 'WK006';
  end if;
  if v_log.lifted_at is not null or (v_log.ends_at is not null and v_log.ends_at <= now()) then
    raise exception 'ban is not active' using errcode = 'WK011';
  end if;
  if v_log.ends_at is not distinct from p_ends_at then
    raise exception 'already at that end' using errcode = 'WK011';
  end if;

  update public.ban_log set ends_at = p_ends_at where id = p_ban_log_id;
  update private.bans set ends_at = p_ends_at where ban_log_id = p_ban_log_id;

  perform private.log_admin_action(
    'change_ban', v_reason, v_log.page_title, v_log.revision_id, v_log.pseudonym,
    private.ban_end_note(p_ends_at)
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."change_ban_end"(bigint, timestamp with time zone, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."change_ban_end"(bigint, timestamp with time zone, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."change_ban_end"(bigint, timestamp with time zone, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."change_ban_end"(bigint, timestamp with time zone, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."change_ban_end"(bigint, timestamp with time zone, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.delete_page (
  p_page_id bigint,
  p_reason  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."delete_page"(bigint, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."delete_page"(bigint, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."delete_page"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_page"(bigint, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."delete_page"(bigint, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.grant_admin (
  p_revision_id bigint,
  p_reason      text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."grant_admin"(bigint, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."grant_admin"(bigint, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."grant_admin"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."grant_admin"(bigint, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."grant_admin"(bigint, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.lift_ban (
  p_ban_log_id bigint,
  p_reason     text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."lift_ban"(bigint, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."lift_ban"(bigint, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."lift_ban"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."lift_ban"(bigint, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."lift_ban"(bigint, text) FROM PUBLIC, "anon";

-- 관리자 목록. 관리자 전용 이름만 돌려준다.
CREATE OR REPLACE FUNCTION public.list_admins()
  RETURNS TABLE (
    admin_handle text,
    is_me        boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_admin();
  return query
  select member.admin_handle, member.id = private.current_member_id()
  from private.members as member
  where member.is_admin
  order by member.admin_handle;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."list_admins"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_admins"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_admins"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_admins"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_admins"() FROM PUBLIC, "anon";

-- 같은 사람의 다른 편집을 보는 허가를 연다. 사유를 받고 공개 기록에 남긴다. 허가는 10분 동안
-- 이 관리자에게만 유효하고, 화면에는 사람 대신 이 허가의 ID만 간다. 같은 사람에 대해 2분 넘게 남은
-- 허가가 있으면 그것을 돌려주고 다시 기록하지 않는다. 곧 끝날 허가는 다시 쓰지 않고 새로 연다.
CREATE OR REPLACE FUNCTION public.open_author_lookup (
  p_revision_id bigint,
  p_reason      text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_admin_id bigint := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_target record;
  v_lookup_id uuid;
begin
  select * into v_target from private.revision_target(p_revision_id);
  if v_target.member_id is null then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;

  select lookup.id into v_lookup_id
  from private.author_lookups as lookup
  where lookup.admin_member_id = v_admin_id
    and lookup.target_member_id = v_target.member_id
    and lookup.expires_at > now() + interval '2 minutes'
  order by lookup.expires_at desc
  limit 1;
  if v_lookup_id is not null then
    return v_lookup_id;
  end if;

  insert into private.author_lookups (admin_member_id, target_member_id, source_revision_id, admin_log_id)
  values (
    v_admin_id, v_target.member_id, p_revision_id,
    private.log_admin_action(
      'view_author_edits', v_reason, v_target.page_title, p_revision_id, v_target.pseudonym
    )
  )
  returning id into v_lookup_id;
  return v_lookup_id;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."open_author_lookup"(bigint, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."open_author_lookup"(bigint, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."open_author_lookup"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."open_author_lookup"(bigint, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."open_author_lookup"(bigint, text) FROM PUBLIC, "anon";

-- 허가의 근거 판과 끝나는 시각.
CREATE OR REPLACE FUNCTION public.get_author_lookup (
  p_lookup_id uuid
)
  RETURNS TABLE (
    source_revision_id bigint,
    expires_at         timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_admin();
  perform private.author_lookup_target(p_lookup_id);
  return query
  select lookup.source_revision_id, lookup.expires_at
  from private.author_lookups as lookup
  where lookup.id = p_lookup_id;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."get_author_lookup"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."get_author_lookup"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_author_lookup"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_author_lookup"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_author_lookup"(uuid) FROM PUBLIC, "anon";

-- 유효한 허가로만 읽는다. 사유와 기록은 허가를 열 때 이미 남았다.
CREATE OR REPLACE FUNCTION public.list_author_edits (
  p_lookup_id          uuid,
  p_before_revision_id bigint DEFAULT NULL::bigint
)
  RETURNS TABLE (
    revision_id        bigint,
    page_title         text,
    pseudonym          text,
    kind               text,
    summary            text,
    byte_delta         integer,
    created_at         timestamp with time zone,
    parent_revision_id bigint,
    is_current         boolean,
    hidden_at          timestamp with time zone,
    page_deleted       boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_target_id bigint;
begin
  perform private.require_admin();
  v_target_id := private.author_lookup_target(p_lookup_id);

  return query
  select
    revision.id, page.title, revision.author_pseudonym, revision.kind, revision.summary,
    revision.byte_delta, revision.created_at, revision.parent_revision_id,
    revision.id = page.current_revision_id, revision.hidden_at, page.deleted_at is not null
  from private.revision_authors as author
  join public.revisions as revision on revision.id = author.revision_id
  join public.pages as page on page.id = revision.page_id
  where author.member_id = v_target_id
    and (p_before_revision_id is null or revision.id < p_before_revision_id)
  order by revision.id desc
  limit 50;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(uuid, bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(uuid, bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_author_edits"(uuid, bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(uuid, bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_author_edits"(uuid, bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.restore_page (
  p_page_id bigint,
  p_reason  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."restore_page"(bigint, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."restore_page"(bigint, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."restore_page"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."restore_page"(bigint, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."restore_page"(bigint, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.revoke_admin (
  p_admin_handle text,
  p_reason       text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."revoke_admin"(text, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."revoke_admin"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."revoke_admin"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."revoke_admin"(text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."revoke_admin"(text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_protection (
  p_page_id bigint,
  p_level   text,
  p_reason  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."set_protection"(bigint, text, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_protection"(bigint, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_protection"(bigint, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_protection"(bigint, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."set_protection"(bigint, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_revision_hidden (
  p_revision_id bigint,
  p_hidden      boolean,
  p_reason      text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."set_revision_hidden"(bigint, boolean, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_revision_hidden"(bigint, boolean, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_revision_hidden"(bigint, boolean, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_revision_hidden"(bigint, boolean, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."set_revision_hidden"(bigint, boolean, text) FROM PUBLIC, "anon";

-- ── 공개 기록 ────────────────────────────────────────────────────────────────
CREATE TABLE "public"."admin_log" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "action"      text                     NOT NULL,
  -- 대상 문서의 그때 제목. 문서가 이동·삭제돼도 기록은 읽을 수 있어야 한다.
  "page_title"  text,
  "revision_id" bigint,
  -- 근거가 된 판의 가명(그 문서에서의). 관리자 지정·해제에는 남기지 않는다.
  "pseudonym"   text,
  "reason"      text                     NOT NULL,
  -- 기간, 보호 등급 같은 덧붙임.
  "note"        text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "admin_log_action"
    CHECK
    ((action = ANY (ARRAY['ban'::text, 'lift_ban'::text, 'grant_admin'::text, 'revoke_admin'::text, 'protect'::text, 'unprotect'::text, 'delete_page'::text, 'restore_page'::text,
    'hide_revision'::text, 'unhide_revision'::text, 'view_author_edits'::text, 'change_ban'::text]))),
  CONSTRAINT "admin_log_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."admin_log"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_log_select" ON "public"."admin_log"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.can_read() AS can_read));

REVOKE ALL ON SEQUENCE "public"."admin_log_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."admin_log_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."admin_log_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."admin_log_id_seq" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_log" TO "service_role";

REVOKE ALL ON TABLE "public"."admin_log" FROM "authenticated";

GRANT SELECT ON TABLE "public"."admin_log" TO "authenticated";

REVOKE ALL ON TABLE "public"."admin_log" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_log" TO "postgres";

REVOKE ALL ON TABLE "public"."admin_log" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."admin_log_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."admin_log_id_seq" FROM "authenticated";

-- ── private ──────────────────────────────────────────────────────────────────
-- 누가 한 조치인지. 감사용이고 화면에는 내지 않는다.
CREATE TABLE "private"."admin_actions" (
  "admin_log_id"    bigint NOT NULL,
  "actor_member_id" bigint,
  CONSTRAINT "admin_actions_pkey" PRIMARY KEY (admin_log_id),
  CONSTRAINT "admin_actions_actor_member_id_fkey" FOREIGN KEY (actor_member_id) REFERENCES private.members(id) ON DELETE SET NULL,
  CONSTRAINT "admin_actions_admin_log_id_fkey" FOREIGN KEY (admin_log_id) REFERENCES public.admin_log(id) ON DELETE CASCADE
);

ALTER TABLE "private"."admin_actions"
  ENABLE ROW LEVEL SECURITY;

-- 차단 내역. 근거가 된 문서의 가명으로만 공개한다. 효과는 모든 문서에 미친다.
CREATE TABLE "public"."ban_log" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "pseudonym"   text                     NOT NULL,
  "page_title"  text                     NOT NULL,
  "revision_id" bigint,
  "starts_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "ends_at"     timestamp with time zone,
  "reason"      text                     NOT NULL,
  "lifted_at"   timestamp with time zone,
  CONSTRAINT "ban_log_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ban_log"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ban_log_select" ON "public"."ban_log"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.can_read() AS can_read));

REVOKE ALL ON SEQUENCE "public"."ban_log_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."ban_log_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."ban_log_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."ban_log_id_seq" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ban_log" TO "service_role";

REVOKE ALL ON TABLE "public"."ban_log" FROM "authenticated";

GRANT SELECT ON TABLE "public"."ban_log" TO "authenticated";

REVOKE ALL ON TABLE "public"."ban_log" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ban_log" TO "postgres";

REVOKE ALL ON TABLE "public"."ban_log" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."ban_log_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."ban_log_id_seq" FROM "authenticated";

-- 같은 사람의 다른 편집을 보는 허가. 대상(member)은 여기에만 있고 화면에는 `id`만 간다. 끝난
-- 행도 지우지 않는다. 누가 언제 누구를 봤는지의 감사 기록이라, 회원 행이 지워져도 행은 남긴다.
CREATE TABLE "private"."author_lookups" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "admin_member_id"    bigint,
  "target_member_id"   bigint,
  "source_revision_id" bigint                   NOT NULL,
  "admin_log_id"       bigint,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"         timestamp with time zone NOT NULL DEFAULT (now() + '00:10:00'::interval),
  CONSTRAINT "author_lookups_pkey" PRIMARY KEY (id),
  CONSTRAINT "author_lookups_admin_member_id_fkey" FOREIGN KEY (admin_member_id) REFERENCES private.members(id) ON DELETE SET NULL,
  CONSTRAINT "author_lookups_target_member_id_fkey" FOREIGN KEY (target_member_id) REFERENCES private.members(id) ON DELETE SET NULL,
  CONSTRAINT "author_lookups_admin_log_id_fkey" FOREIGN KEY (admin_log_id) REFERENCES public.admin_log(id) ON DELETE SET NULL
);

ALTER TABLE "private"."author_lookups"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX author_lookups_admin_target_idx ON private.author_lookups USING btree (admin_member_id, target_member_id, expires_at);

-- 이 파일의 테이블을 가리키는 외래 키. 참조하는 테이블이 앞 파일에 있거나 서로를 참조하므로 두 테이블이
-- 모두 생긴 뒤에 붙인다.

ALTER TABLE "private"."bans"
  ADD CONSTRAINT "bans_ban_log_id_fkey" FOREIGN KEY (ban_log_id) REFERENCES public.ban_log(id) ON DELETE SET NULL;
