SET local check_function_bodies = off;

DROP FUNCTION "private"."log_admin_action"(text, text, text, bigint, text, text, bigint);

DROP FUNCTION "private"."promote_member"(bigint, text);

CREATE TABLE "private"."admin_handles" (
  "handle"     text                     NOT NULL,
  "member_id"  bigint,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "admin_handles_handle_member_id_key" UNIQUE (handle, member_id),
  CONSTRAINT "admin_handles_member_id_key" UNIQUE (member_id),
  CONSTRAINT "admin_handles_pkey" PRIMARY KEY (handle)
);

ALTER TABLE "private"."admin_handles"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."admin_log"
  ADD COLUMN "actor_handle" text;

ALTER TABLE "public"."admin_log"
  ADD COLUMN "target_handle" text;

CREATE OR REPLACE FUNCTION private.admin_handle_of (
  p_member_id bigint
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select handle from private.admin_handles where member_id = p_member_id;
$function$;

CREATE OR REPLACE FUNCTION private.discussion_author_name (
  p_page_id   bigint,
  p_member_id bigint,
  p_as_admin  boolean
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if coalesce(p_as_admin, false) then
    if not private.is_admin() then
      raise exception 'admin only' using errcode = '42501';
    end if;
    return private.admin_handle_of(p_member_id);
  end if;
  return private.pseudonym_for(p_page_id, p_member_id);
end;
$function$;

CREATE OR REPLACE FUNCTION private.log_admin_action (
  p_action        text,
  p_reason        text,
  p_page_title    text   DEFAULT NULL::text,
  p_revision_id   bigint DEFAULT NULL::bigint,
  p_pseudonym     text   DEFAULT NULL::text,
  p_note          text   DEFAULT NULL::text,
  p_discussion_id bigint DEFAULT NULL::bigint,
  p_target_handle text   DEFAULT NULL::text
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_log_id bigint;
  v_actor_id bigint := private.current_member_id();
begin
  insert into public.admin_log (
    action, page_title, revision_id, pseudonym, reason, note, discussion_id, actor_handle, target_handle
  )
  values (
    p_action, p_page_title, p_revision_id, p_pseudonym, p_reason, p_note, p_discussion_id,
    private.admin_handle_of(v_actor_id), p_target_handle
  )
  returning id into v_log_id;

  insert into private.admin_actions (admin_log_id, actor_member_id)
  values (v_log_id, v_actor_id);

  return v_log_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.next_admin_handle()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  -- 처음 관리자가 되는 사람의 이름. 관리자 A, B, … Z, 그다음은 관리자 27, 28, …. 한 번 준 이름
  -- (`admin_handles`)은 다시 주지 않는다. 번호는 쓴 이름 수보다 하나 더 넓게 찾으므로 늘 빈 것이 있다.
  select coalesce(
    (
      select '관리자 ' || chr(code)
      from generate_series(ascii('A'), ascii('Z')) as code
      where not exists (
        select 1 from private.admin_handles as used where used.handle = '관리자 ' || chr(code)
      )
      order by code
      limit 1
    ),
    (
      select '관리자 ' || number
      from generate_series(27, 27 + (select count(*) from private.admin_handles)) as number
      where not exists (
        select 1 from private.admin_handles as used where used.handle = '관리자 ' || number
      )
      order by number
      limit 1
    )
  );
$function$;

CREATE OR REPLACE FUNCTION private.promote_member (
  p_member_id bigint
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_handle text;
begin
  perform 1 from private.members where is_admin for update;
  perform 1 from private.members where id = p_member_id for update;
  if exists (select 1 from private.members where id = p_member_id and is_admin) then
    raise exception 'already an admin' using errcode = 'WK011';
  end if;
  if private.member_is_banned(p_member_id) then
    raise exception 'target is banned' using errcode = 'WK002';
  end if;

  select handle into v_handle from private.admin_handles where member_id = p_member_id;
  if v_handle is null then
    v_handle := private.next_admin_handle();
    insert into private.admin_handles (handle, member_id) values (v_handle, p_member_id);
  end if;
  update private.members
     set is_admin = true, admin_handle = v_handle
   where id = p_member_id;
  return v_handle;
end;
$function$;

CREATE OR REPLACE FUNCTION private.write_revision (
  p_page_id   bigint,
  p_member_id bigint,
  p_body      jsonb,
  p_summary   text,
  p_kind      text,
  p_as_admin  boolean DEFAULT false
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_parent_id bigint;
  v_parent_text text;
  v_revision_id bigint;
  v_text text := private.doc_text(p_body);
  v_change record;
begin
  select page.current_revision_id, revision.body_text
  into v_parent_id, v_parent_text
  from public.pages as page
  left join public.revisions as revision on revision.id = page.current_revision_id
  where page.id = p_page_id;
  v_change := private.text_change(v_parent_text, v_text);

  insert into public.revisions (
    page_id, parent_revision_id, body, summary, author_pseudonym, kind, text_size, text_added, text_removed
  )
  values (
    p_page_id,
    v_parent_id,
    p_body,
    coalesce(btrim(p_summary), ''),
    case when p_as_admin then private.admin_handle_of(p_member_id) else private.pseudonym_for(p_page_id, p_member_id) end,
    p_kind,
    private.text_length(v_text),
    v_change.added,
    v_change.removed
  )
  returning id into v_revision_id;

  insert into private.revision_authors (revision_id, member_id)
  values (v_revision_id, p_member_id);

  -- 본문에서 뽑는 일은 한 번만 한다. 넘겨주기 대상과 나머지 참조를 같은 결과에서 나눈다.
  delete from public.page_refs where from_page_id = p_page_id;
  with refs as materialized (
    select ref.kind, ref.target from private.extract_refs(p_body) as ref
  ),
  updated as (
    update public.pages
       set current_revision_id = v_revision_id,
           updated_at = now(),
           redirect_target = (select refs.target from refs where refs.kind = 'redirect' limit 1)
     where id = p_page_id
  )
  insert into public.page_refs (from_page_id, kind, target_key)
  select distinct p_page_id, refs.kind, lower(refs.target)
  from refs
  where refs.kind <> 'redirect';

  return v_revision_id;
end;
$function$;

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
  v_handle text;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);

  select * into v_target from private.revision_target(p_revision_id);
  if v_target.member_id is null then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;
  v_handle := private.promote_member(v_target.member_id);

  -- 새 관리자 이름만 남긴다. 근거 판의 가명과 문서를 남기면 그 가명이 관리자라는 것이 드러난다.
  perform private.log_admin_action('grant_admin', v_reason, p_target_handle => v_handle);
end;
$function$;

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
  v_handle text;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);

  select member_id into v_revocation
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

  -- 이름은 `admin_handles`가 그 사람 것으로 남겨 두었다. 동시에 되돌리거나 차단하면
  -- `promote_member`가 잠근 뒤 확인해 거절한다.
  v_handle := private.promote_member(v_revocation.member_id);
  update private.admin_revocations
     set restored_at = now()
   where admin_log_id = p_admin_log_id;

  -- 지정과 같이 가명은 남기지 않는다. 어느 해제를 되돌렸는지와 관리자 이름만 남긴다.
  perform private.log_admin_action(
    'restore_admin', v_reason, p_note => '기록 #' || p_admin_log_id, p_target_handle => v_handle
  );
end;
$function$;

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
  -- 잘못 해제했을 때 되돌릴 수 있게 대상을 남긴다. 공개 기록에는 관리자 이름만 있다.
  insert into private.admin_revocations (admin_log_id, member_id, admin_handle)
  values (
    private.log_admin_action('revoke_admin', v_reason, p_target_handle => p_admin_handle),
    v_member_id, p_admin_handle
  );
end;
$function$;

ALTER TABLE "private"."admin_handles"
  ADD CONSTRAINT "admin_handles_member_id_fkey" FOREIGN KEY (member_id) REFERENCES private.members(id) ON DELETE SET NULL;

-- 이미 준 관리자 이름을 `admin_handles`에 남긴다. 회원의 외래 키보다 먼저 채운다. 지금 관리자를
-- 먼저 넣는다. 해제된 이름은 최근 것부터 넣고, 사람마다 가장 최근 이름만 그 사람 것으로 둔다. 더 오래된 이름은 주인 없이 남겨
-- 다른 사람에게 주지 않는다. 전에는 7일 뒤 이름을 다시 썼으므로 한 이름을 여러 사람이 받았을 수
-- 있다. 그러면 먼저 넣은 사람의 것이 되고, 나머지 사람은 다시 지정될 때 새 이름을 받는다. 되돌릴 수
-- 있는 해제의 이름은 전에도 비워 두었으므로 다른 사람의 것이 되지 않는다.
INSERT INTO private.admin_handles (handle, member_id)
SELECT member.admin_handle, member.id
FROM private.members AS member
WHERE member.admin_handle IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO private.admin_handles (handle, member_id)
SELECT
  revocation.admin_handle,
  CASE
    WHEN revocation.latest
         AND NOT EXISTS (
           SELECT 1 FROM private.members AS member
           WHERE member.id = revocation.member_id AND member.admin_handle IS NOT NULL
         )
      THEN revocation.member_id
  END
FROM (
  SELECT
    admin_handle,
    member_id,
    admin_log_id,
    row_number() OVER (PARTITION BY member_id ORDER BY admin_log_id DESC) = 1 AS latest
  FROM private.admin_revocations
) AS revocation
ORDER BY revocation.admin_log_id DESC
ON CONFLICT DO NOTHING;

ALTER TABLE "private"."members"
  ADD CONSTRAINT "members_admin_handle_fkey" FOREIGN KEY (admin_handle, id) REFERENCES private.admin_handles(handle, member_id);

REVOKE ALL ON FUNCTION "private"."admin_handle_of"(bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."log_admin_action"(text, text, text, bigint, text, text, bigint, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."promote_member"(bigint) FROM PUBLIC;
