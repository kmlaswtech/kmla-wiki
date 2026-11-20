-- 같은 사람의 다른 편집 조회를 10분짜리 허가로 바꾸고, 차단 기간을 자유롭게 정하고 바꿀 수 있게 한다.
--
-- 오류 코드. `20261116000300_admin.sql`의 표는 배포된 migration이라 고치지 않고, 새 코드는 여기에 둔다.
--   WK016  조회 허가가 없거나, 끝났거나, ID 꼴이 아니다(다시 사유를 적고 조회한다)
--   WK017  차단 기간이 1시간보다 짧거나 10년보다 길다

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

CREATE OR REPLACE FUNCTION private.ban_end (
  p_length interval
)
  RETURNS timestamp WITH time zone
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

REVOKE ALL ON FUNCTION "public"."ban_editor"(bigint, interval, text) FROM PUBLIC, "anon";

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

REVOKE ALL ON FUNCTION "public"."change_ban_end"(bigint, interval, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_author_lookup (
  p_lookup_id text
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
declare
  v_lookup private.author_lookups;
begin
  perform private.require_admin();
  v_lookup := private.author_lookup(p_lookup_id);
  source_revision_id := v_lookup.source_revision_id;
  expires_at := v_lookup.expires_at;
  return next;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."get_author_lookup"(text) FROM PUBLIC, "anon";

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

CREATE OR REPLACE FUNCTION public.list_author_edits (
  p_lookup_id          text,
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
  v_target_id := (private.author_lookup(p_lookup_id)).target_member_id;

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

REVOKE ALL ON FUNCTION "public"."list_author_edits"(text, bigint) FROM PUBLIC, "anon";

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

REVOKE ALL ON FUNCTION "private"."author_lookup"(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."ban_end"(interval) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."ban_end_note"(timestamp WITH time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."lock_active_ban"(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."ban_editor"(bigint, interval, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."ban_editor"(bigint, interval, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ban_editor"(bigint, interval, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ban_editor"(bigint, interval, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."change_ban_end"(bigint, interval, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."change_ban_end"(bigint, interval, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."change_ban_end"(bigint, interval, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."change_ban_end"(bigint, interval, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_author_lookup"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_author_lookup"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_author_lookup"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_author_lookup"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(text, bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_author_edits"(text, bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(text, bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(text, bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."open_author_lookup"(bigint, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."open_author_lookup"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."open_author_lookup"(bigint, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."open_author_lookup"(bigint, text) TO "service_role";
