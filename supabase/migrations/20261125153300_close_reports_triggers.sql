SET local check_function_bodies = off;

DROP FUNCTION "private"."close_page_discussion_reports"(bigint);

DROP FUNCTION "private"."close_reports"(bigint[], bigint[], text);

DROP FUNCTION "public"."list_open_post_reports"();

DROP FUNCTION "public"."list_open_reports"();

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
  -- 거두기는 작성자가 한 일이라 처리자를 적지 않는다.
  perform private.close_reports(
    '{}',
    array(select post.id from private.discussion_posts as post where post.discussion_id = new.id),
    p_by_admin => old.withdrawn_at is not distinct from new.withdrawn_at
  );
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
  -- 거두기는 작성자가 한 일이라 처리자를 적지 않는다.
  perform private.close_reports(
    '{}', array[new.id], p_by_admin => old.withdrawn_at is not distinct from new.withdrawn_at
  );
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
  p_resolution   text     DEFAULT 'handled'::text,
  p_by_admin     boolean  DEFAULT true
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
         resolved_by_member_id = case when p_by_admin then private.current_member_id() end,
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

CREATE OR REPLACE FUNCTION public.list_open_post_reports()
  RETURNS TABLE (
    post_id           bigint,
    discussion_id     bigint,
    discussion_title  text,
    page_title        text,
    author_name       text,
    kind              text,
    body              text,
    post_created_at   timestamp with time zone,
    first_reported_at timestamp with time zone,
    reports           jsonb,
    dismissed_count   integer
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_admin();
  return query
  select
    post.id, discussion.id, discussion.title, page.title, post.author_name, post.kind,
    post.body, post.created_at, grouped.first_reported_at, grouped.reports,
    (
      select count(*)::integer from private.reports as earlier
      where earlier.post_id = grouped.post_id and earlier.resolution = 'dismissed'
    )
  from (
    select
      report.post_id,
      min(report.created_at) as first_reported_at,
      jsonb_agg(
        jsonb_build_object('category', report.category, 'note', report.note, 'created_at', report.created_at)
        order by report.created_at
      ) as reports
    from private.reports as report
    where report.resolved_at is null and report.post_id is not null
    group by report.post_id
  ) as grouped
  join private.discussion_posts as post on post.id = grouped.post_id
  join private.discussions as discussion on discussion.id = post.discussion_id
  join public.pages as page on page.id = discussion.page_id
  -- 자르지 않는다. 머리띠의 수(`count_open_reports`)에 든 글을 모두 보여야 닫을 수 있다.
  order by grouped.first_reported_at;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_open_post_reports"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_open_reports()
  RETURNS TABLE (
    revision_id         bigint,
    page_id             bigint,
    page_title          text,
    pseudonym           text,
    parent_revision_id  bigint,
    revision_created_at timestamp with time zone,
    is_current          boolean,
    first_reported_at   timestamp with time zone,
    reports             jsonb,
    dismissed_count     integer
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_admin();
  return query
  select
    revision.id, page.id, page.title, revision.author_pseudonym, revision.parent_revision_id,
    revision.created_at, revision.id = page.current_revision_id,
    grouped.first_reported_at, grouped.reports,
    (
      select count(*)::integer from private.reports as earlier
      where earlier.revision_id = grouped.revision_id and earlier.resolution = 'dismissed'
    )
  from (
    select
      report.revision_id,
      min(report.created_at) as first_reported_at,
      jsonb_agg(
        jsonb_build_object('category', report.category, 'note', report.note, 'created_at', report.created_at)
        order by report.created_at
      ) as reports
    from private.reports as report
    where report.resolved_at is null and report.revision_id is not null
    group by report.revision_id
  ) as grouped
  join public.revisions as revision on revision.id = grouped.revision_id
  join public.pages as page on page.id = revision.page_id
  -- 자르지 않는다. 머리띠의 수(`count_open_reports`)에 든 판을 모두 보여야 닫을 수 있다.
  order by grouped.first_reported_at;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_open_reports"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.report_discussion_post (
  p_post_id  bigint,
  p_category text,
  p_note     text   DEFAULT ''::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_note text := private.check_report_note(p_category, p_note);
begin
  -- 문서, 토론, 글을 이 순서로 잠근다. 관리자가 같은 때 숨기거나 지우거나 문서를 삭제하면 그 일이
  -- 끝난 뒤 다시 보고 거절한다. 그러지 않으면 트리거가 신고를 닫은 뒤에 이 신고가 들어가 열린 채
  -- 남는다. 다른 토론 쓰기(`lock_discussion`)처럼 토론을 글보다 먼저 잠가, 같은 글을 거두는 일과 서로
  -- 기다리지 않게 한다.
  perform 1 from public.pages
   where id = (
     select discussion.page_id
     from private.discussion_posts as post
     join private.discussions as discussion on discussion.id = post.discussion_id
     where post.id = p_post_id
   )
     for share;
  perform 1 from private.discussions
   where id = (select discussion_id from private.discussion_posts where id = p_post_id)
     for share;
  perform 1
    from private.discussion_posts as post
    join private.discussions as discussion on discussion.id = post.discussion_id
   where post.id = p_post_id
     and post.kind in ('open', 'post')
     and post.hidden_at is null
     and post.withdrawn_at is null
     and post.member_id <> v_member_id
     and private.discussion_is_public(discussion)
     for share of post;
  if not found then
    raise exception 'post not found' using errcode = 'WK006';
  end if;
  perform private.insert_report(v_member_id, null, p_post_id, p_category, v_note);
end;
$function$;

CREATE OR REPLACE FUNCTION public.report_revision (
  p_revision_id bigint,
  p_category    text,
  p_note        text   DEFAULT ''::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_note text := private.check_report_note(p_category, p_note);
begin
  -- 문서와 판을 잠근다. 관리자가 같은 때 숨기거나 삭제하면 그 일이 끝난 뒤 다시 보고 거절한다. 그러지
  -- 않으면 트리거가 신고를 닫은 뒤에 이 신고가 들어가 열린 채 남는다. 관리자 쪽
  -- (`revert_and_hide_revision`)처럼 문서를 먼저 잠가 서로 기다리지 않게 한다.
  perform 1 from public.pages
   where id = (select page_id from public.revisions where id = p_revision_id)
     for share;
  perform 1
    from public.revisions as revision
    join public.pages as page on page.id = revision.page_id
   where revision.id = p_revision_id
     and revision.hidden_at is null
     and page.deleted_at is null
     for share of revision;
  if not found then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;
  perform private.insert_report(v_member_id, p_revision_id, null, p_category, v_note);
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

REVOKE ALL ON FUNCTION "private"."close_reports"(bigint[], bigint[], text, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_open_post_reports"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_open_post_reports"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_open_post_reports"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_open_post_reports"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_open_reports"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_open_reports"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_open_reports"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_open_reports"() TO "service_role";

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
