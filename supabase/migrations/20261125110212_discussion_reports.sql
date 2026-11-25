SET local check_function_bodies = off;

DROP FUNCTION "private"."close_reports"(bigint[]);

ALTER TABLE "private"."reports"
  ADD COLUMN "post_id" bigint;

ALTER TABLE "private"."reports"
  ALTER COLUMN "revision_id" DROP NOT NULL;

CREATE OR REPLACE FUNCTION private.check_report_note (
  p_category text,
  p_note     text
)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  v_note text := btrim(coalesce(p_note, ''));
begin
  if p_category is null or p_category not in ('privacy', 'abuse', 'vandalism', 'other') then
    raise exception 'invalid category' using errcode = '22023';
  end if;
  if char_length(v_note) > 300 then
    raise exception 'note too long' using errcode = 'WK005', detail = 'note';
  end if;
  if p_category = 'other' and char_length(v_note) < 2 then
    raise exception 'a reason is required' using errcode = 'WK014';
  end if;
  return v_note;
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_report_rate (
  p_member_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform 1 from private.members where id = p_member_id for update;
  if (
    select count(*) from private.reports as report
    where report.reporter_member_id = p_member_id
      and report.created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'too many reports' using errcode = 'WK019';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.close_page_discussion_reports (
  p_page_id bigint
)
  RETURNS integer
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select private.close_reports('{}', array(
    select post.id
    from private.discussion_posts as post
    join private.discussions as discussion on discussion.id = post.discussion_id
    where discussion.page_id = p_page_id
  ));
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
     set resolved_at = now(), resolved_by_member_id = private.current_member_id(), resolution = p_resolution
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
  perform private.close_reports(array(select revision.id from public.revisions as revision where revision.page_id = p_page_id));
  perform private.close_page_discussion_reports(p_page_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.count_open_reports()
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_admin();
  return (
    select (count(distinct report.revision_id) + count(distinct report.post_id))::integer
    from private.reports as report where report.resolved_at is null
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_open_post_reports()
  RETURNS TABLE (
    post_id              bigint,
    discussion_id        bigint,
    discussion_title     text,
    page_title           text,
    author_name          text,
    kind                 text,
    body                 text,
    post_created_at      timestamp with time zone,
    hidden_at            timestamp with time zone,
    withdrawn_at         timestamp with time zone,
    discussion_withdrawn boolean,
    discussion_deleted   boolean,
    first_reported_at    timestamp with time zone,
    reports              jsonb,
    dismissed_count      integer
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
    post.body, post.created_at, post.hidden_at, post.withdrawn_at, discussion.withdrawn_at is not null,
    discussion.deleted_at is not null or page.deleted_at is not null,
    grouped.first_reported_at, grouped.reports,
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
    hidden_at           timestamp with time zone,
    is_current          boolean,
    page_deleted        boolean,
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
    revision.created_at, revision.hidden_at, revision.id = page.current_revision_id,
    page.deleted_at is not null, grouped.first_reported_at, grouped.reports,
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
  -- 글과 토론을 잠근다. 관리자가 같은 때 숨기거나 지우면 그 일이 끝난 뒤 다시 보고 거절한다. 그러지
  -- 않으면 숨긴 뒤에 들어온 신고가 닫히지 않고 남는다.
  perform 1
    from private.discussion_posts as post
    join private.discussions as discussion on discussion.id = post.discussion_id
   where post.id = p_post_id
     and post.hidden_at is null
     and post.withdrawn_at is null
     and post.member_id <> v_member_id
     and private.can_see_discussion(discussion)
     for share of post, discussion;
  if not found then
    raise exception 'post not found' using errcode = 'WK006';
  end if;
  -- 기각된 글은 같은 사람이 다시 신고하지 않는다. 글은 고칠 수 없으므로 같은 판단이 나온다.
  if exists (
    select 1 from private.reports as report
    where report.post_id = p_post_id
      and report.reporter_member_id = v_member_id
      and report.resolution = 'dismissed'
  ) then
    raise exception 'already dismissed' using errcode = 'WK011';
  end if;
  perform private.check_report_rate(v_member_id);

  begin
    insert into private.reports (post_id, reporter_member_id, category, note)
    values (p_post_id, v_member_id, p_category, v_note);
  exception when unique_violation then
    raise exception 'already reported' using errcode = 'WK011';
  end;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."report_discussion_post"(bigint, text, text) FROM PUBLIC, "anon";

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
  if not exists (
    select 1
    from public.revisions as revision
    join public.pages as page on page.id = revision.page_id
    where revision.id = p_revision_id
      and revision.hidden_at is null
      and page.deleted_at is null
  ) then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;
  -- 기각된 판은 같은 사람이 다시 신고하지 않는다. 판의 내용은 바뀌지 않으므로 같은 판단이 나온다.
  if exists (
    select 1 from private.reports as report
    where report.revision_id = p_revision_id
      and report.reporter_member_id = v_member_id
      and report.resolution = 'dismissed'
  ) then
    raise exception 'already dismissed' using errcode = 'WK011';
  end if;
  perform private.check_report_rate(v_member_id);

  begin
    insert into private.reports (revision_id, reporter_member_id, category, note)
    values (p_revision_id, v_member_id, p_category, v_note);
  exception when unique_violation then
    raise exception 'already reported' using errcode = 'WK011';
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_post_reports (
  p_post_id    bigint,
  p_resolution text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_count integer;
begin
  perform private.require_admin();
  v_count := private.close_reports('{}', array[p_post_id], p_resolution);
  if v_count = 0 then
    raise exception 'no open reports' using errcode = 'WK011';
  end if;
  return v_count;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."resolve_post_reports"(bigint, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.resolve_reports (
  p_revision_id bigint,
  p_resolution  text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_count integer;
begin
  perform private.require_admin();
  v_count := private.close_reports(array[p_revision_id], p_resolution => p_resolution);
  if v_count = 0 then
    raise exception 'no open reports' using errcode = 'WK011';
  end if;
  return v_count;
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
  if p_deleted then
    perform private.close_reports('{}', array(
      select post.id from private.discussion_posts as post where post.discussion_id = p_discussion_id
    ));
  end if;
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
  if p_hidden then
    perform private.close_reports('{}', array[p_post_id]);
  end if;
  perform private.log_admin_action(
    case when p_hidden then 'hide_discussion_post' else 'unhide_discussion_post' end,
    v_reason, (select title from public.pages where id = v_discussion.page_id),
    p_pseudonym => v_post.author_name, p_discussion_id => v_discussion.id
  );
end;
$function$;

ALTER TABLE "private"."reports"
  ADD CONSTRAINT "reports_post_id_fkey" FOREIGN KEY (post_id) REFERENCES private.discussion_posts(id) ON DELETE CASCADE;

ALTER TABLE "private"."reports"
  ADD CONSTRAINT "reports_target" CHECK ((num_nonnulls(revision_id, post_id) = 1));

CREATE INDEX reports_post_idx ON private.reports USING btree (post_id)
  WHERE (post_id IS NOT NULL);

CREATE UNIQUE INDEX reports_post_open_unique ON private.reports USING btree (post_id, reporter_member_id)
  WHERE ((resolved_at IS NULL) AND (post_id IS NOT NULL));

REVOKE ALL ON FUNCTION "private"."check_report_note"(text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."check_report_rate"(bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."close_page_discussion_reports"(bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."close_reports"(bigint[], bigint[], text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_open_post_reports"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_open_post_reports"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_open_post_reports"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_open_post_reports"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."report_discussion_post"(bigint, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."report_discussion_post"(bigint, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."report_discussion_post"(bigint, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."report_discussion_post"(bigint, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."resolve_post_reports"(bigint, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."resolve_post_reports"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_post_reports"(bigint, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_post_reports"(bigint, text) TO "service_role";
