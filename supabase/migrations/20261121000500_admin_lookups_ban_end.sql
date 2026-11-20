-- 같은 사람의 다른 편집 조회를 10분짜리 허가로 바꾸고, 차단 기한을 시각으로 받고 바꿀 수 있게 한다.
--
-- 오류 코드. `20261116000300_admin.sql`의 표는 배포된 migration이라 고치지 않고, 새 코드는 여기에 둔다.
--   WK016  조회 허가가 없거나 끝났다(다시 사유를 적고 조회한다)

SET local check_function_bodies = off;

ALTER TABLE "public"."admin_log"
  DROP CONSTRAINT "admin_log_action";

DROP FUNCTION "public"."ban_editor"(bigint, integer, text);

DROP FUNCTION "public"."list_author_edits"(bigint, text, bigint);

CREATE TABLE "private"."author_lookups" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "admin_member_id"    bigint,
  "target_member_id"   bigint,
  "source_revision_id" bigint                   NOT NULL,
  "admin_log_id"       bigint,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"         timestamp with time zone NOT NULL DEFAULT (now() + '00:10:00'::interval),
  CONSTRAINT "author_lookups_pkey" PRIMARY KEY (id)
);

ALTER TABLE "private"."author_lookups"
  ENABLE ROW LEVEL SECURITY;

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

CREATE OR REPLACE FUNCTION private.ban_end_note (
  p_ends_at timestamp with time zone
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

CREATE OR REPLACE FUNCTION private.check_ban_end (
  p_ends_at timestamp with time zone
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

REVOKE ALL ON FUNCTION "public"."ban_editor"(bigint, timestamp WITH time zone, text) FROM PUBLIC, "anon";

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

REVOKE ALL ON FUNCTION "public"."change_ban_end"(bigint, timestamp WITH time zone, text) FROM PUBLIC, "anon";

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

REVOKE ALL ON FUNCTION "public"."get_author_lookup"(uuid) FROM PUBLIC, "anon";

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

REVOKE ALL ON FUNCTION "public"."list_author_edits"(uuid, bigint) FROM PUBLIC, "anon";

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

REVOKE ALL ON FUNCTION "public"."open_author_lookup"(bigint, text) FROM PUBLIC, "anon";

ALTER TABLE "private"."author_lookups"
  ADD CONSTRAINT "author_lookups_admin_log_id_fkey" FOREIGN KEY (admin_log_id) REFERENCES public.admin_log(id) ON DELETE SET NULL;

ALTER TABLE "private"."author_lookups"
  ADD CONSTRAINT "author_lookups_admin_member_id_fkey" FOREIGN KEY (admin_member_id) REFERENCES private.members(id) ON DELETE SET NULL;

ALTER TABLE "private"."author_lookups"
  ADD CONSTRAINT "author_lookups_target_member_id_fkey" FOREIGN KEY (target_member_id) REFERENCES private.members(id) ON DELETE SET NULL;

ALTER TABLE "public"."admin_log"
  ADD CONSTRAINT "admin_log_action"
    CHECK
    ((action = ANY (ARRAY['ban'::text, 'lift_ban'::text, 'grant_admin'::text, 'revoke_admin'::text, 'protect'::text, 'unprotect'::text, 'delete_page'::text, 'restore_page'::text,
    'hide_revision'::text, 'unhide_revision'::text, 'view_author_edits'::text, 'change_ban'::text])));

CREATE INDEX author_lookups_admin_target_idx ON private.author_lookups USING btree (admin_member_id, target_member_id, expires_at);

REVOKE ALL ON FUNCTION "private"."author_lookup_target"(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."ban_end_note"(timestamp WITH time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."check_ban_end"(timestamp WITH time zone) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."ban_editor"(bigint, timestamp WITH time zone, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."ban_editor"(bigint, timestamp WITH time zone, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ban_editor"(bigint, timestamp WITH time zone, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ban_editor"(bigint, timestamp WITH time zone, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."change_ban_end"(bigint, timestamp WITH time zone, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."change_ban_end"(bigint, timestamp WITH time zone, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."change_ban_end"(bigint, timestamp WITH time zone, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."change_ban_end"(bigint, timestamp WITH time zone, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_author_lookup"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_author_lookup"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_author_lookup"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_author_lookup"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(uuid, bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_author_edits"(uuid, bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(uuid, bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(uuid, bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."open_author_lookup"(bigint, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."open_author_lookup"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."open_author_lookup"(bigint, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."open_author_lookup"(bigint, text) TO "service_role";
