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
-- 해제한 사람은 판을 다시 찾을 수 없으므로, 이 기간 안에는 해제 기록으로 되돌린다.
CREATE OR REPLACE FUNCTION private.revocation_restore_window()
  RETURNS interval
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select interval '7 days';
$function$;

REVOKE ALL ON FUNCTION "private"."revocation_restore_window"() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.next_admin_handle()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  -- 관리자 A, B, … Z, 그다음은 번호. 되돌릴 수 있는 해제의 이름은 비워 둔다.
  select coalesce(
    (
      select '관리자 ' || chr(code)
      from generate_series(ascii('A'), ascii('Z')) as code
      where not exists (
        select 1 from private.members where admin_handle = '관리자 ' || chr(code)
      )
        and not exists (
          select 1 from private.restorable_revocations as revocation
          where revocation.admin_handle = '관리자 ' || chr(code)
        )
      order by code
      limit 1
    ),
    '관리자 ' || (select count(*) + 1 from private.members where is_admin)
  );
$function$;

REVOKE ALL ON FUNCTION "private"."next_admin_handle"() FROM PUBLIC;

-- 회원을 관리자로 만든다. 지정과 해제 되돌리기가 함께 쓴다. `p_handle`이 비어 있으면 그 이름을
-- 주고, 아니면 새 이름을 준다. 잠금 순서(관리자 행 전체 → 대상 행)는 여기에만 둔다. 확인은 잠근
-- 뒤에 하므로 같은 이름을 동시에 고르지 않고, `ban_editor`(대상 행을 잠금)와 겹쳐 차단된 관리자가
-- 생기지 않는다.
CREATE OR REPLACE FUNCTION private.promote_member (
  p_member_id bigint,
  p_handle    text DEFAULT NULL::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform 1 from private.members where is_admin for update;
  perform 1 from private.members where id = p_member_id for update;
  if exists (select 1 from private.members where id = p_member_id and is_admin) then
    raise exception 'already an admin' using errcode = 'WK011';
  end if;
  if private.member_is_banned(p_member_id) then
    raise exception 'target is banned' using errcode = 'WK002';
  end if;

  update private.members
     set is_admin = true,
         admin_handle = case
           when p_handle is not null
                and not exists (select 1 from private.members where admin_handle = p_handle)
             then p_handle
           else private.next_admin_handle()
         end
   where id = p_member_id;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."promote_member"(bigint, text) FROM PUBLIC;

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

-- 문서를 삭제한다(숨긴다). 삭제 판을 `관리자` 이름으로 쓰고, 삭제된 문서의 판은 보이지 않으므로 그
-- 판들의 신고를 닫는다. 잠금, 검사, 기록은 부르는 쪽이 한다.
CREATE OR REPLACE FUNCTION private.delete_page_as_admin (
  p_page_id  bigint,
  p_admin_id bigint,
  p_body     jsonb,
  p_summary  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.write_revision(p_page_id, p_admin_id, p_body, p_summary, 'delete', true);
  update public.pages set deleted_at = now() where id = p_page_id;
  perform private.close_reports(array(select revision.id from public.revisions as revision where revision.page_id = p_page_id));
end;
$function$;

REVOKE ALL ON FUNCTION "private"."delete_page_as_admin"(bigint, bigint, jsonb, text) FROM PUBLIC;

-- 차단 길이에서 끝나는 시각을 낸다. NULL은 기한 없음이다. 서버 시계로 세고, 개월은 Postgres가 그
-- 달의 마지막 날로 맞춘다(1월 31일 + 1개월 = 2월 28일).
CREATE OR REPLACE FUNCTION private.ban_end (
  p_length interval
)
  RETURNS timestamp with time zone
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
begin
  if p_length is null then
    return null;
  end if;
  if p_length < interval '1 hour' or now() + p_length > now() + interval '10 years' then
    raise exception 'invalid ban length' using errcode = 'WK017';
  end if;
  return now() + p_length;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."ban_end"(interval) FROM PUBLIC;

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

-- `p_length`가 NULL이면 기한 없음.
CREATE OR REPLACE FUNCTION public.ban_editor (
  p_revision_id bigint,
  p_length      interval,
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
  v_ends_at timestamptz := private.ban_end(p_length);
  v_target record;
  v_ban_log_id bigint;
begin

  select * into v_target from private.revision_target(p_revision_id);
  if v_target.member_id is null then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;
  -- `promote_member`와 같은 행을 잠근다. 확인과 차단 사이에 관리자가 되지 않게 한다.
  perform 1 from private.members where id = v_target.member_id for update;
  if exists (select 1 from private.members where id = v_target.member_id and is_admin) then
    raise exception 'target is an admin' using errcode = 'WK010';
  end if;
  if private.member_is_banned(v_target.member_id) then
    raise exception 'already banned' using errcode = 'WK011';
  end if;

  insert into public.ban_log (pseudonym, page_title, revision_id, ends_at, reason)
  values (v_target.pseudonym, v_target.page_title, p_revision_id, v_ends_at, v_reason)
  returning id into v_ban_log_id;

  insert into private.bans (member_id, ends_at, reason, created_by_member_id, ban_log_id)
  values (v_target.member_id, v_ends_at, v_reason, v_admin_id, v_ban_log_id);

  perform private.log_admin_action(
    'ban', v_reason, v_target.page_title, p_revision_id, v_target.pseudonym,
    private.ban_end_note(v_ends_at)
  );
  return v_ban_log_id;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."ban_editor"(bigint, interval, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."ban_editor"(bigint, interval, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."ban_editor"(bigint, interval, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ban_editor"(bigint, interval, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."ban_editor"(bigint, interval, text) FROM PUBLIC, "anon";

-- 진행 중인 차단의 기간을 지금부터 다시 정한다(연장, 단축, 기한 없음으로). 해제했다 다시 차단하지
-- 않아도 된다.
CREATE OR REPLACE FUNCTION public.change_ban_end (
  p_ban_log_id bigint,
  p_length     interval,
  p_reason     text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_reason text;
  v_ends_at timestamptz;
  v_log public.ban_log;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);
  v_ends_at := private.ban_end(p_length);
  v_log := private.lock_active_ban(p_ban_log_id);
  if v_log.ends_at is null and v_ends_at is null then
    raise exception 'already without end' using errcode = 'WK011';
  end if;

  update public.ban_log set ends_at = v_ends_at where id = p_ban_log_id;
  update private.bans set ends_at = v_ends_at where ban_log_id = p_ban_log_id;

  perform private.log_admin_action(
    'change_ban', v_reason, v_log.page_title, v_log.revision_id, v_log.pseudonym,
    private.ban_end_note(v_ends_at)
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."change_ban_end"(bigint, interval, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."change_ban_end"(bigint, interval, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."change_ban_end"(bigint, interval, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."change_ban_end"(bigint, interval, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."change_ban_end"(bigint, interval, text) FROM PUBLIC, "anon";

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
  perform private.delete_page_as_admin(p_page_id, v_admin_id, coalesce(v_body, private.empty_doc()), v_reason);
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
  perform private.promote_member(v_target.member_id);

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
  v_log public.ban_log := private.lock_active_ban(p_ban_log_id);
begin
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

-- 관리자 목록. 관리자 전용 이름과 별명만 돌려준다.
CREATE OR REPLACE FUNCTION public.list_admins()
  RETURNS TABLE (
    admin_handle   text,
    admin_nickname text,
    is_me          boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_admin();
  return query
  select member.admin_handle, member.admin_nickname, member.id = private.current_member_id()
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

-- 내 관리자 별명을 정하거나(빈 값이면) 지운다. 관리자끼리 서로를 알아보게 돕는 것이라 관리자
-- 목록에만 보인다. 공개 기록에 남기면 관리자 이름과 별명이 함께 공개되므로 기록하지 않는다.
CREATE OR REPLACE FUNCTION public.set_admin_nickname (
  p_nickname text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_admin();
  v_nickname text := nullif(btrim(p_nickname), '');
begin
  if char_length(v_nickname) > 20 or v_nickname ~ '[[:cntrl:]]' then
    raise exception 'invalid admin nickname' using errcode = 'WK021';
  end if;

  -- 동시에 해제되었으면 아무것도 바꾸지 않는다(해제가 별명을 지운다).
  update private.members set admin_nickname = v_nickname
  where id = v_member_id and is_admin;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."set_admin_nickname"(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_admin_nickname"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_admin_nickname"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_admin_nickname"(text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."set_admin_nickname"(text) FROM PUBLIC, "anon";

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

  v_lookup_id := private.reusable_lookup(v_admin_id, v_target.member_id);
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

-- 이 판을 쓴 사람에 대해 내가 연, 다시 쓸 수 있는 허가. 없으면 NULL. 사유를 적고 연 허가로 돌아가는
-- 길이라 기록을 남기지 않는다. 다른 사람의 허가나 새 허가는 만들지 않는다.
CREATE OR REPLACE FUNCTION public.find_author_lookup (
  p_revision_id bigint
)
  RETURNS uuid
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_admin_id bigint := private.require_admin();
  v_target record;
begin
  select * into v_target from private.revision_target(p_revision_id);
  if v_target.member_id is null then
    return null;
  end if;
  return private.reusable_lookup(v_admin_id, v_target.member_id);
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."find_author_lookup"(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."find_author_lookup"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."find_author_lookup"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."find_author_lookup"(bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."find_author_lookup"(bigint) FROM PUBLIC, "anon";

-- 내가 연, 아직 유효한 조회 허가. 근거 판의 문서와 가명은 허가를 열 때의 공개 기록에서 가져온다.
CREATE OR REPLACE FUNCTION public.list_my_author_lookups()
  RETURNS TABLE (
    lookup_id          uuid,
    source_revision_id bigint,
    page_title         text,
    pseudonym          text,
    expires_at         timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_admin_id bigint := private.require_admin();
begin
  return query
  select lookup.id, lookup.source_revision_id, log.page_title, log.pseudonym, lookup.expires_at
  from private.author_lookups as lookup
  left join public.admin_log as log on log.id = lookup.admin_log_id
  where lookup.admin_member_id = v_admin_id
    and lookup.expires_at > now()
  order by lookup.expires_at desc;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."list_my_author_lookups"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_my_author_lookups"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_my_author_lookups"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_my_author_lookups"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_my_author_lookups"() FROM PUBLIC, "anon";

-- 허가의 근거 판과 끝나는 시각. 근거 판의 문서, 가명, 상태도 돌려준다. 근거 판이 목록의 앞쪽에 없어도
-- 화면이 "이 사람에 대한 조치"를 보일 수 있게 한다.
CREATE OR REPLACE FUNCTION public.get_author_lookup (
  p_lookup_id text
)
  RETURNS TABLE (
    source_revision_id bigint,
    expires_at         timestamp with time zone,
    page_title         text,
    pseudonym          text,
    hidden_at          timestamp with time zone,
    is_current         boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_lookup private.author_lookups;
begin
  perform private.require_admin();
  v_lookup := private.author_lookup(p_lookup_id);
  return query
  select
    v_lookup.source_revision_id, v_lookup.expires_at, page.title, revision.author_pseudonym,
    revision.hidden_at, revision.id = page.current_revision_id
  from public.revisions as revision
  join public.pages as page on page.id = revision.page_id
  where revision.id = v_lookup.source_revision_id;
  -- 판은 지우지 않으므로 보통은 생기지 않는다. 생기면 다른 허가 문제처럼 다시 조회하게 한다.
  if not found then
    raise exception 'lookup source missing' using errcode = 'WK016';
  end if;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."get_author_lookup"(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."get_author_lookup"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_author_lookup"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_author_lookup"(text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_author_lookup"(text) FROM PUBLIC, "anon";

-- 유효한 허가로만 읽는다. 사유와 기록은 허가를 열 때 이미 남았다. 조치 뒤에는 화면이 이미 불러온 만큼
-- (`p_limit`, 500까지) 한 번에 다시 읽는다.
CREATE OR REPLACE FUNCTION public.list_author_edits (
  p_lookup_id          text,
  p_before_revision_id bigint  DEFAULT NULL::bigint,
  p_limit              integer DEFAULT 50
)
  RETURNS TABLE (
    revision_id        bigint,
    page_id            bigint,
    page_title         text,
    pseudonym          text,
    kind               text,
    summary            text,
    text_added         integer,
    text_removed       integer,
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
  v_target_id := (private.author_lookup(p_lookup_id)).target_member_id;

  return query
  select
    revision.id, page.id, page.title, revision.author_pseudonym, revision.kind, revision.summary,
    revision.text_added, revision.text_removed, revision.created_at, revision.parent_revision_id,
    revision.id = page.current_revision_id, revision.hidden_at, page.deleted_at is not null
  from private.revision_authors as author
  join public.revisions as revision on revision.id = author.revision_id
  join public.pages as page on page.id = revision.page_id
  where author.member_id = v_target_id
    and (p_before_revision_id is null or revision.id < p_before_revision_id)
  order by revision.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 500);
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(text, bigint, integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(text, bigint, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_author_edits"(text, bigint, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(text, bigint, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_author_edits"(text, bigint, integer) FROM PUBLIC, "anon";

-- 일괄 되돌리기의 문서별 계획. 대상이 `p_from_revision_id`부터 쓴 판을 걷어 낸다. 문서마다 그 판들을
-- 뺀 마지막 판(대상이 쓰지 않았거나 시작점보다 앞선 판)으로 돌아간다. 그런 판이 없으면 대상이 범위
-- 안에서 만든 문서라 삭제한다. `p_page_ids`가 있으면 그 문서만 본다.
--
-- status:
--   revert    현재 판이 대상의 판이다. 되돌린다.
--   delete    돌아갈 판이 없다. 삭제한다.
--   same      되돌려도 본문이 같다(이동만 했거나 스스로 되돌렸다). 할 일이 없다.
--   clean     다른 사람이 이미 대상의 첫 편집 앞 본문으로 되돌렸다. 할 일이 없다.
--   hidden    돌아갈 판이 숨긴 판이다. 숨긴 내용을 새 판으로 다시 공개하지 않도록 건너뛴다.
--   conflict  대상의 편집 뒤에 다른 사람이 편집했다. 건너뛴다.
--   deleted   이미 삭제된 문서다. 건너뛴다.
-- kept_count: 되돌려도 남는 대상의 편집 수. 대상의 편집 사이에 다른 사람의 판이 끼어 있으면, 돌아갈
-- 판(다른 사람의 판)에 대상의 앞선 편집이 들어 있다.
-- move_leftover: 대상의 이동이 옛 이름에 남긴 넘겨주기다(이동 판과 같은 트랜잭션에서 생겼다). 지우면
-- 옮겨진 문서를 옛 이름으로 다시 옮기는 길이 막히지 않지만, 화면은 처음에 고르지 않는다.
CREATE OR REPLACE FUNCTION private.bulk_revert_plan (
  p_target_id        bigint,
  p_from_revision_id bigint,
  p_page_ids         bigint[] DEFAULT NULL::bigint[]
)
  RETURNS TABLE (
    page_id             bigint,
    page_title          text,
    current_revision_id bigint,
    restore_revision_id bigint,
    edit_count          integer,
    kept_count          integer,
    has_move            boolean,
    move_leftover       boolean,
    status              text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with bad as materialized (
    select revision.id, revision.page_id, revision.kind
    from private.revision_authors as author
    join public.revisions as revision on revision.id = author.revision_id
    where author.member_id = p_target_id
      and revision.id >= coalesce(p_from_revision_id, 0)
      and (p_page_ids is null or revision.page_id = any (p_page_ids))
  ),
  touched as (
    select bad.page_id, min(bad.id) as first_bad_id from bad group by bad.page_id
  ),
  planned as (
    select
      page.id, page.title, page.current_revision_id, page.deleted_at,
      exists (select 1 from bad where bad.id = page.current_revision_id) as current_is_bad,
      -- 대상의 판이 아닌 마지막 판. 판 색인(`revisions_page_idx`)을 최신부터 읽어 처음 만나는 판이다.
      (
        select revision.id from public.revisions as revision
        where revision.page_id = page.id
          and not exists (select 1 from bad where bad.id = revision.id)
        order by revision.id desc
        limit 1
      ) as restore_id,
      -- 대상의 첫 편집 바로 앞 판. 현재 본문이 이것과 같으면 누군가 이미 되돌렸다.
      (
        select revision.id from public.revisions as revision
        where revision.page_id = page.id and revision.id < touched.first_bad_id
        order by revision.id desc
        limit 1
      ) as before_id
    from touched
    join public.pages as page on page.id = touched.page_id
  ),
  -- 되돌리면 걷어 낼 판(`removed`)과 남는 판. 충돌이나 삭제된 문서면 이 문서에서 대상이 쓴 판 전부를
  -- 걷어 낼 판으로 센다(보이기만 한다).
  counted as (
    select
      planned.id as page_id,
      count(*) filter (where flag.removed)::integer as edit_count,
      count(*) filter (where not flag.removed)::integer as kept_count,
      coalesce(bool_or(bad.kind = 'move') filter (where flag.removed), false) as has_move
    from planned
    join bad on bad.page_id = planned.id
    cross join lateral (
      select planned.deleted_at is not null
          or not planned.current_is_bad
          or bad.id > coalesce(planned.restore_id, 0) as removed
    ) as flag
    group by planned.id
  )
  select
    planned.id,
    planned.title,
    planned.current_revision_id,
    planned.restore_id,
    counted.edit_count,
    counted.kept_count,
    counted.has_move,
    -- 이동이 남긴 넘겨주기: 문서의 첫 판이 대상의 이동 판과 같은 트랜잭션(같은 시각)에 쓰였다.
    -- 대상의 판만 시각 색인(`revision_authors_member_idx`)으로 찾는다.
    case when planned.restore_id is null then exists (
      select 1
      from public.revisions as first_revision
      join private.revision_authors as mover
        on mover.member_id = p_target_id and mover.created_at = first_revision.created_at
      join public.revisions as moved on moved.id = mover.revision_id and moved.kind = 'move'
      where first_revision.id = (
          select min(revision.id) from public.revisions as revision where revision.page_id = planned.id
        )
    ) else false end,
    case
      when planned.deleted_at is not null then 'deleted'
      when not planned.current_is_bad then
        case when before_rev.body = current_rev.body then 'clean' else 'conflict' end
      when planned.restore_id is null then 'delete'
      when restore_rev.hidden_at is not null then 'hidden'
      when private.settle_redirect_body(planned.title, restore_rev.body) = current_rev.body then 'same'
      else 'revert'
    end
  from planned
  join counted on counted.page_id = planned.id
  left join public.revisions as current_rev on current_rev.id = planned.current_revision_id
  left join public.revisions as restore_rev on restore_rev.id = planned.restore_id
  left join public.revisions as before_rev on before_rev.id = planned.before_id
  order by planned.current_revision_id desc;
$function$;

REVOKE ALL ON FUNCTION "private"."bulk_revert_plan"(bigint, bigint, bigint[]) FROM PUBLIC;

-- 일괄 되돌리기 미리보기. 기록을 남기지 않는다. `p_from_revision_id`가 NULL이면 대상의 모든 편집이다.
CREATE OR REPLACE FUNCTION public.preview_bulk_revert (
  p_lookup_id          text,
  p_from_revision_id   bigint DEFAULT NULL::bigint
)
  RETURNS TABLE (
    page_id             bigint,
    page_title          text,
    current_revision_id bigint,
    restore_revision_id bigint,
    edit_count          integer,
    kept_count          integer,
    has_move            boolean,
    move_leftover       boolean,
    status              text
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
  v_target_id := (private.author_lookup(p_lookup_id)).target_member_id;
  return query
  select * from private.bulk_revert_plan(v_target_id, p_from_revision_id)
  limit 500;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."preview_bulk_revert"(text, bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."preview_bulk_revert"(text, bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."preview_bulk_revert"(text, bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."preview_bulk_revert"(text, bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."preview_bulk_revert"(text, bigint) FROM PUBLIC, "anon";

-- 일괄 되돌리기 실행. `p_items`는 `[{"page_id": 1, "current_revision_id": 2}, …]`이고, 현재 판은
-- 미리보기 때 본 값이다. 계획은 문서를 잠근 뒤 서버가 다시 세운다. 그 사이 현재 판이 바뀌었거나 할
-- 일이 없는 문서는 건너뛴다(`skipped`). 판은 `관리자` 이름으로 쓰고, 공개 기록에는 한 줄만 남긴다.
CREATE OR REPLACE FUNCTION public.bulk_revert (
  p_lookup_id        text,
  p_from_revision_id bigint,
  p_items            jsonb,
  p_reason           text
)
  RETURNS TABLE (
    page_id    bigint,
    page_title text,
    outcome    text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_admin_id bigint := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_lookup private.author_lookups;
  v_expected jsonb;
  v_page_ids bigint[];
  v_plan record;
  v_body jsonb;
  v_source record;
  v_reverted integer := 0;
  v_deleted integer := 0;
begin
  v_lookup := private.author_lookup(p_lookup_id);
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;

  -- 문서 id → 미리보기 때의 현재 판.
  select
    coalesce(jsonb_object_agg(item ->> 'page_id', item -> 'current_revision_id'), '{}'::jsonb),
    coalesce(array_agg(distinct (item ->> 'page_id')::bigint), '{}')
  into v_expected, v_page_ids
  from jsonb_array_elements(p_items) as item;
  if cardinality(v_page_ids) = 0 then
    raise exception 'nothing to save' using errcode = 'WK007';
  end if;
  if cardinality(v_page_ids) > 200 then
    raise exception 'too many pages' using errcode = 'WK018';
  end if;

  -- 문서를 id 순서로 잠근다. 다른 저장이나 다른 일괄 되돌리기와 서로를 기다리지 않게 한다.
  perform 1 from public.pages as page where page.id = any (v_page_ids) order by page.id for update;

  for v_plan in
    select * from private.bulk_revert_plan(v_lookup.target_member_id, p_from_revision_id, v_page_ids) as plan
    order by plan.page_id
  loop
    page_id := v_plan.page_id;
    page_title := v_plan.page_title;
    if (v_expected ->> v_plan.page_id::text)::bigint is distinct from v_plan.current_revision_id
       or v_plan.status not in ('revert', 'delete') then
      outcome := 'skipped';
    elsif v_plan.status = 'revert' then
      select private.settle_redirect_body(v_plan.page_title, revision.body) into v_body
      from public.revisions as revision where revision.id = v_plan.restore_revision_id;
      perform private.write_revision(
        v_plan.page_id, v_admin_id, v_body,
        format('r%s 판으로 되돌림: 일괄 되돌리기', v_plan.restore_revision_id), 'revert', true
      );
      v_reverted := v_reverted + 1;
      outcome := 'reverted';
      -- 걷어 낸 판(돌아갈 판 뒤의 대상의 판)에 걸린 신고를 닫는다.
      perform private.close_reports(array(
        select author.revision_id
        from private.revision_authors as author
        join public.revisions as revision on revision.id = author.revision_id
        where author.member_id = v_lookup.target_member_id
          and revision.page_id = v_plan.page_id
          and revision.id >= coalesce(p_from_revision_id, 0)
          and revision.id > v_plan.restore_revision_id
      ));
    else
      -- `delete_page`와 같다. 현재 본문 그대로 삭제 판을 쓰고 숨긴다. 관리자가 복구할 수 있다.
      select revision.body into v_body
      from public.revisions as revision where revision.id = v_plan.current_revision_id;
      perform private.delete_page_as_admin(v_plan.page_id, v_admin_id, v_body, '일괄 되돌리기로 삭제');
      v_deleted := v_deleted + 1;
      outcome := 'deleted';
    end if;
    return next;
  end loop;

  if v_reverted + v_deleted > 0 then
    select * into v_source from private.revision_target(v_lookup.source_revision_id);
    perform private.log_admin_action(
      'bulk_revert', v_reason, v_source.page_title, v_lookup.source_revision_id, v_source.pseudonym,
      format('문서 %s개 되돌림, %s개 삭제', v_reverted, v_deleted)
    );
  end if;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."bulk_revert"(text, bigint, jsonb, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."bulk_revert"(text, bigint, jsonb, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."bulk_revert"(text, bigint, jsonb, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."bulk_revert"(text, bigint, jsonb, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."bulk_revert"(text, bigint, jsonb, text) FROM PUBLIC, "anon";

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

  update private.members
     set is_admin = false, admin_handle = null, admin_nickname = null
   where id = v_member_id;
  -- 잘못 해제했을 때 되돌릴 수 있게 대상을 남긴다. 공개 기록에는 여전히 대상이 없다.
  insert into private.admin_revocations (admin_log_id, member_id, admin_handle)
  values (private.log_admin_action('revoke_admin', v_reason), v_member_id, p_admin_handle);
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."revoke_admin"(text, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."revoke_admin"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."revoke_admin"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."revoke_admin"(text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."revoke_admin"(text, text) FROM PUBLIC, "anon";

-- 되돌릴 수 있는 해제 목록(관리자 전용). 관리자 전용 이름과 공개 기록 ID만 돌려준다. 차단된
-- 사람은 되돌릴 수 없으므로 보여 주지 않는다.
CREATE OR REPLACE FUNCTION public.list_restorable_revocations()
  RETURNS TABLE (
    admin_log_id     bigint,
    admin_handle     text,
    reason           text,
    restorable_until timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_admin();
  return query
  select revocation.admin_log_id, revocation.admin_handle, revocation.reason,
         revocation.restorable_until
  from private.restorable_revocations as revocation
  where not private.member_is_banned(revocation.member_id)
  order by revocation.admin_log_id desc;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."list_restorable_revocations"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_restorable_revocations"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_restorable_revocations"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_restorable_revocations"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_restorable_revocations"() FROM PUBLIC, "anon";

-- 해제를 되돌린다. 같은 사람을 되도록 같은 이름으로 다시 관리자로 만든다.
CREATE OR REPLACE FUNCTION public.restore_revoked_admin (
  p_admin_log_id bigint,
  p_reason       text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_reason text;
  v_revocation record;
  v_revoked_at timestamp with time zone;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);

  select member_id, admin_handle into v_revocation
  from private.restorable_revocations
  where admin_log_id = p_admin_log_id;
  if not found then
    select log.created_at into v_revoked_at
    from private.admin_revocations as revocation
    join public.admin_log as log on log.id = revocation.admin_log_id
    where revocation.admin_log_id = p_admin_log_id;
    if v_revoked_at is null then
      raise exception 'revocation not found' using errcode = 'WK006';
    elsif v_revoked_at <= now() - private.revocation_restore_window() then
      raise exception 'too late to restore' using errcode = 'WK020';
    end if;
    -- 이미 되돌렸거나, 다시 지정됐거나, 같은 사람의 더 최근 해제가 있다.
    raise exception 'already restored' using errcode = 'WK011';
  end if;

  -- 이름은 기간 동안 비워 두었다. 그래도 겹치면(SQL로 직접 바꾼 경우, 번호 이름) 새 이름을 준다.
  -- 동시에 되돌리거나 차단하면 `promote_member`가 잠근 뒤 확인해 거절한다.
  perform private.promote_member(v_revocation.member_id, v_revocation.admin_handle);
  update private.admin_revocations
     set restored_at = now()
   where admin_log_id = p_admin_log_id;

  -- 지정과 같이 대상은 공개하지 않는다. 어느 해제를 되돌렸는지만 남긴다.
  perform private.log_admin_action(
    'restore_admin', v_reason, null, null, null, '기록 #' || p_admin_log_id
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."restore_revoked_admin"(bigint, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."restore_revoked_admin"(bigint, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."restore_revoked_admin"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."restore_revoked_admin"(bigint, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."restore_revoked_admin"(bigint, text) FROM PUBLIC, "anon";

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

-- 판을 숨긴다. 현재 판이면 먼저 그 앞의 보이는 판으로 되돌린다(`관리자` 이름의 새 판). 보이는 앞 판이
-- 없으면(문서의 첫 판이거나 앞 판이 모두 숨겨졌다) 빈 본문으로 문서를 삭제한다. 숨긴 내용이 삭제 판이나
-- 복구로 다시 나오지 않게 한다. 숨기기는 `set_revision_hidden`이 하고 기록하며 신고도 닫는다.
CREATE OR REPLACE FUNCTION public.revert_and_hide_revision (
  p_revision_id bigint,
  p_reason      text
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
  v_restore public.revisions;
begin
  select page.* into v_page
  from public.revisions as revision
  join public.pages as page on page.id = revision.page_id
  where revision.id = p_revision_id
  for update of page;
  if v_page.id is null then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;

  if v_page.current_revision_id = p_revision_id then
    select * into v_restore
    from public.revisions as revision
    where revision.page_id = v_page.id and revision.id < p_revision_id and revision.hidden_at is null
    order by revision.id desc
    limit 1;
    if v_restore.id is null then
      perform private.delete_page_as_admin(v_page.id, v_admin_id, private.empty_doc(), v_reason);
      perform private.log_admin_action('delete_page', v_reason, v_page.title);
    else
      perform private.write_revision(
        v_page.id, v_admin_id, private.settle_redirect_body(v_page.title, v_restore.body),
        format('r%s 판으로 되돌림', v_restore.id), 'revert', true
      );
    end if;
  end if;

  perform public.set_revision_hidden(p_revision_id, true, v_reason);
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."revert_and_hide_revision"(bigint, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."revert_and_hide_revision"(bigint, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."revert_and_hide_revision"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."revert_and_hide_revision"(bigint, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."revert_and_hide_revision"(bigint, text) FROM PUBLIC, "anon";

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
  if p_hidden then
    perform private.close_reports(array[p_revision_id]);
  end if;
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
    'hide_revision'::text, 'unhide_revision'::text, 'view_author_edits'::text, 'change_ban'::text, 'bulk_revert'::text, 'restore_admin'::text]))),
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

-- 관리자 해제의 대상. 되돌리기(`restore_revoked_admin`)에만 쓰고 화면에는 이름만 낸다.
CREATE TABLE "private"."admin_revocations" (
  "admin_log_id" bigint                   NOT NULL,
  "member_id"    bigint                   NOT NULL,
  "admin_handle" text                     NOT NULL,
  "restored_at"  timestamp with time zone,
  CONSTRAINT "admin_revocations_pkey" PRIMARY KEY (admin_log_id),
  CONSTRAINT "admin_revocations_admin_log_id_fkey" FOREIGN KEY (admin_log_id) REFERENCES public.admin_log(id) ON DELETE CASCADE,
  CONSTRAINT "admin_revocations_member_id_fkey" FOREIGN KEY (member_id) REFERENCES private.members(id) ON DELETE CASCADE
);

ALTER TABLE "private"."admin_revocations"
  ENABLE ROW LEVEL SECURITY;

-- 지금 되돌릴 수 있는 해제. 목록, 되돌리기, 이름 비워 두기(`next_admin_handle`)가 모두 이것만
-- 읽는다. 기간 안이고, 되돌리지 않았고, 그 사람이 지금 관리자가 아닌 해제 중 사람마다 가장 최근
-- 것 하나다.
CREATE VIEW "private"."restorable_revocations" AS
  SELECT DISTINCT ON (revocation.member_id)
    revocation.admin_log_id,
    revocation.member_id,
    revocation.admin_handle,
    log.reason,
    log.created_at + private.revocation_restore_window() AS restorable_until
  FROM private.admin_revocations revocation
  JOIN public.admin_log log ON log.id = revocation.admin_log_id
  JOIN private.members member ON member.id = revocation.member_id
  WHERE revocation.restored_at IS NULL
    AND log.created_at > now() - private.revocation_restore_window()
    AND NOT member.is_admin
  ORDER BY revocation.member_id, revocation.admin_log_id DESC;

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

-- 같은 관리자, 같은 사람에 대해 2분 넘게 남은 허가. 곧 끝날 허가는 다시 쓰지 않는다.
CREATE OR REPLACE FUNCTION private.reusable_lookup (
  p_admin_id  bigint,
  p_target_id bigint
)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select lookup.id
  from private.author_lookups as lookup
  where lookup.admin_member_id = p_admin_id
    and lookup.target_member_id = p_target_id
    and lookup.expires_at > now() + interval '2 minutes'
  order by lookup.expires_at desc
  limit 1;
$function$;

REVOKE ALL ON FUNCTION "private"."reusable_lookup"(bigint, bigint) FROM PUBLIC;

-- 관리자 본인이 연, 아직 유효한 조회 허가. 없거나, 끝났거나, ID 꼴이 아니면(손으로 고친 주소) WK016.
CREATE OR REPLACE FUNCTION private.author_lookup (
  p_lookup_id text
)
  RETURNS private.author_lookups
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_lookup private.author_lookups;
begin
  begin
    select * into v_lookup
    from private.author_lookups as lookup
    where lookup.id = p_lookup_id::uuid
      and lookup.admin_member_id = private.current_member_id()
      and lookup.expires_at > now();
  exception when invalid_text_representation then
    v_lookup := null;
  end;
  if v_lookup.id is null then
    raise exception 'lookup expired' using errcode = 'WK016';
  end if;
  return v_lookup;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."author_lookup"(text) FROM PUBLIC;

-- 진행 중인 차단 기록을 잠그고 돌려준다. 없으면 WK006, 이미 끝났거나 해제됐으면 WK011.
CREATE OR REPLACE FUNCTION private.lock_active_ban (
  p_ban_log_id bigint
)
  RETURNS public.ban_log
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_log public.ban_log;
begin
  select * into v_log from public.ban_log where id = p_ban_log_id for update;
  if v_log.id is null then
    raise exception 'ban not found' using errcode = 'WK006';
  end if;
  if v_log.lifted_at is not null or (v_log.ends_at is not null and v_log.ends_at <= now()) then
    raise exception 'ban is not active' using errcode = 'WK011';
  end if;
  return v_log;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."lock_active_ban"(bigint) FROM PUBLIC;

-- 이 파일의 테이블을 가리키는 외래 키. 참조하는 테이블이 앞 파일에 있거나 서로를 참조하므로 두 테이블이
-- 모두 생긴 뒤에 붙인다.

ALTER TABLE "private"."bans"
  ADD CONSTRAINT "bans_ban_log_id_fkey" FOREIGN KEY (ban_log_id) REFERENCES public.ban_log(id) ON DELETE SET NULL;
