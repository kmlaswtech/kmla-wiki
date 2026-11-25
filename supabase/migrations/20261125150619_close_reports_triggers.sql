SET local check_function_bodies = off;

DROP FUNCTION "private"."close_page_discussion_reports"(bigint);

CREATE OR REPLACE FUNCTION private.close_deleted_page_post_reports()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.close_reports('{}', array(
    select post.id
    from private.discussion_posts as post
    join private.discussions as discussion on discussion.id = post.discussion_id
    where discussion.page_id = new.id
  ));
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.close_deleted_page_revision_reports()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.close_reports(array(
    select revision.id from public.revisions as revision where revision.page_id = new.id
  ));
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.close_hidden_discussion_reports()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.close_reports('{}', array(
    select post.id from private.discussion_posts as post where post.discussion_id = new.id
  ));
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.close_hidden_post_reports()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.close_reports('{}', array[new.id]);
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.close_hidden_revision_reports()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.close_reports(array[new.id]);
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.close_reports (
  p_revision_ids bigint[],
  p_post_ids     bigint[] DEFAULT '{}'::bigint[],
  p_resolution   text     DEFAULT 'handled'::text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_count integer;
begin
  if p_resolution is null or p_resolution not in ('handled', 'dismissed') then
    raise exception 'invalid resolution' using errcode = '22023';
  end if;
  update private.reports
     set resolved_at = now(),
         resolved_by_member_id = case when private.is_admin() then private.current_member_id() end,
         resolution = p_resolution
   where (revision_id = any (p_revision_ids) or post_id = any (p_post_ids)) and resolved_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

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
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_discussion_deleted (
  p_discussion_id bigint,
  p_deleted       boolean,
  p_reason        text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_reason text;
  v_discussion private.discussions;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);

  select * into v_discussion from private.discussions where id = p_discussion_id for update;
  if v_discussion.id is null or v_discussion.withdrawn_at is not null then
    raise exception 'discussion not found' using errcode = 'WK006';
  end if;
  if (v_discussion.deleted_at is not null) = coalesce(p_deleted, false) then
    raise exception 'already in that state' using errcode = 'WK011';
  end if;

  update private.discussions
     set deleted_at = case when p_deleted then now() end
   where id = p_discussion_id;
  perform private.log_admin_action(
    case when p_deleted then 'delete_discussion' else 'restore_discussion' end,
    v_reason, (select title from public.pages where id = v_discussion.page_id),
    p_discussion_id => v_discussion.id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_discussion_post_hidden (
  p_post_id bigint,
  p_hidden  boolean,
  p_reason  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_reason text;
  v_post private.discussion_posts;
  v_discussion private.discussions;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);

  select * into v_post from private.discussion_posts where id = p_post_id for update;
  if v_post.id is null then
    raise exception 'post not found' using errcode = 'WK006';
  end if;
  if (v_post.hidden_at is not null) = coalesce(p_hidden, false) then
    raise exception 'already in that state' using errcode = 'WK011';
  end if;
  select * into v_discussion from private.discussions where id = v_post.discussion_id;

  update private.discussion_posts
     set hidden_at = case when p_hidden then now() end
   where id = p_post_id;
  perform private.log_admin_action(
    case when p_hidden then 'hide_discussion_post' else 'unhide_discussion_post' end,
    v_reason, (select title from public.pages where id = v_discussion.page_id),
    p_pseudonym => v_post.author_name, p_discussion_id => v_discussion.id
  );
end;
$function$;

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

CREATE TRIGGER close_reports_on_hide
  AFTER UPDATE OF hidden_at ON private.discussion_posts
  FOR EACH ROW
  WHEN (((old.hidden_at IS NULL) AND (new.hidden_at IS NOT NULL)))
  EXECUTE FUNCTION private.close_hidden_post_reports();

CREATE TRIGGER close_reports_on_withdraw
  AFTER UPDATE OF withdrawn_at ON private.discussion_posts
  FOR EACH ROW
  WHEN (((old.withdrawn_at IS NULL) AND (new.withdrawn_at IS NOT NULL)))
  EXECUTE FUNCTION private.close_hidden_post_reports();

CREATE TRIGGER close_reports_on_delete
  AFTER UPDATE OF deleted_at ON private.discussions
  FOR EACH ROW
  WHEN (((old.deleted_at IS NULL) AND (new.deleted_at IS NOT NULL)))
  EXECUTE FUNCTION private.close_hidden_discussion_reports();

CREATE TRIGGER close_reports_on_withdraw
  AFTER UPDATE OF withdrawn_at ON private.discussions
  FOR EACH ROW
  WHEN (((old.withdrawn_at IS NULL) AND (new.withdrawn_at IS NOT NULL)))
  EXECUTE FUNCTION private.close_hidden_discussion_reports();

CREATE TRIGGER close_post_reports_on_delete
  AFTER UPDATE OF deleted_at ON public.pages
  FOR EACH ROW
  WHEN (((old.deleted_at IS NULL) AND (new.deleted_at IS NOT NULL)))
  EXECUTE FUNCTION private.close_deleted_page_post_reports();

CREATE TRIGGER close_revision_reports_on_delete
  AFTER UPDATE OF deleted_at ON public.pages
  FOR EACH ROW
  WHEN (((old.deleted_at IS NULL) AND (new.deleted_at IS NOT NULL)))
  EXECUTE FUNCTION private.close_deleted_page_revision_reports();

CREATE TRIGGER close_reports_on_hide
  AFTER UPDATE OF hidden_at ON public.revisions
  FOR EACH ROW
  WHEN (((old.hidden_at IS NULL) AND (new.hidden_at IS NOT NULL)))
  EXECUTE FUNCTION private.close_hidden_revision_reports();

REVOKE ALL ON FUNCTION "private"."close_deleted_page_post_reports"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."close_deleted_page_revision_reports"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."close_hidden_discussion_reports"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."close_hidden_post_reports"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."close_hidden_revision_reports"() FROM PUBLIC;

-- 백필. 트리거 전에 보이지 않게 된 대상(숨긴 판, 삭제된 문서, 숨기거나 거둔 글, 지우거나 거둔 토론)에
-- 열려 있는 신고를 닫는다. 그때까지 거두기는 신고를 닫지 않았다. 처리자는 없다.
UPDATE private.reports AS report
   SET resolved_at = now(), resolution = 'handled'
 WHERE report.resolved_at IS NULL
   AND (
     EXISTS (
       SELECT 1 FROM public.revisions AS revision
       JOIN public.pages AS page ON page.id = revision.page_id
       WHERE revision.id = report.revision_id
         AND (revision.hidden_at IS NOT NULL OR page.deleted_at IS NOT NULL)
     )
     OR EXISTS (
       SELECT 1 FROM private.discussion_posts AS post
       JOIN private.discussions AS discussion ON discussion.id = post.discussion_id
       JOIN public.pages AS page ON page.id = discussion.page_id
       WHERE post.id = report.post_id
         AND (post.hidden_at IS NOT NULL OR post.withdrawn_at IS NOT NULL
              OR discussion.deleted_at IS NOT NULL OR discussion.withdrawn_at IS NOT NULL
              OR page.deleted_at IS NOT NULL)
     )
   );
