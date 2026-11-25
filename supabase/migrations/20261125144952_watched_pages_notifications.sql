SET local check_function_bodies = off;

CREATE TABLE "private"."notification_marks" (
  "member_id" bigint                   NOT NULL,
  "seen_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notification_marks_pkey" PRIMARY KEY (member_id)
);

ALTER TABLE "private"."notification_marks"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."watched_pages" (
  "member_id"  bigint                   NOT NULL,
  "page_id"    bigint                   NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "watched_pages_pkey" PRIMARY KEY (member_id, page_id)
);

ALTER TABLE "private"."watched_pages"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.notifications_for (
  p_member_id bigint
)
  RETURNS TABLE (
    reason           text,
    page_title       text,
    discussion_id    bigint,
    discussion_title text,
    new_count        integer,
    first_post_id    bigint,
    from_revision_id bigint,
    to_revision_id   bigint,
    author_name      text,
    last_at          timestamp with time zone,
    unread           boolean
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  -- 머리띠가 1분마다 부른다. 즐겨찾기한 문서와 최근 30일에 움직인 토론에서 시작해, 내 글과 편집 전체를 훑지
  -- 않는다.
  with mark as (
    select coalesce(
      (select mark.seen_at from private.notification_marks as mark where mark.member_id = p_member_id),
      '-infinity'
    ) as seen_at
  ),
  watched as (
    select
      watch.page_id, watch.created_at as watched_at,
      -- 내가 이 문서를 마지막으로 편집한 판. 그 앞의 편집은 알리지 않는다. 문서마다 한 번 찾는다.
      coalesce((
        select max(revision.id)
        from public.revisions as revision
        join private.revision_authors as author on author.revision_id = revision.id
        where revision.page_id = watch.page_id and author.member_id = p_member_id
      ), 0) as my_last_revision_id
    from private.watched_pages as watch
    join public.pages as page on page.id = watch.page_id
    where watch.member_id = p_member_id and page.deleted_at is null
  ),
  recent as (
    select * from private.discussions as discussion
    where discussion.last_post_at > now() - interval '30 days'
      and private.discussion_is_public(discussion)
  ),
  mine as (
    select post.discussion_id, max(post.id) as last_mine_id
    from recent
    join private.discussion_posts as post on post.discussion_id = recent.id
    where post.member_id = p_member_id
      and post.kind <> 'rename'
      and post.withdrawn_at is null
      and post.hidden_at is null
    group by post.discussion_id
  ),
  replies as (
    select
      'reply'::text as reason, null::bigint as page_id, mine.discussion_id,
      coalesce(nullif(count(*) filter (where post.created_at > mark.seen_at), 0), count(*))::integer
        as new_count,
      coalesce(min(post.id) filter (where post.created_at > mark.seen_at), min(post.id)) as first_post_id,
      max(post.id) as last_post_id,
      null::bigint as first_revision_id, null::bigint as last_revision_id
    from mark, mine
    join private.discussion_posts as post
      on post.discussion_id = mine.discussion_id and post.id > mine.last_mine_id
    -- 관리자의 제목 바꾸기 글은 새 글로 치지 않는다(내가 바꾼 것도 여기에 걸린다).
    where post.kind <> 'rename'
      and post.withdrawn_at is null
      and post.hidden_at is null
      and post.created_at > now() - interval '30 days'
    group by mine.discussion_id
  ),
  opened as (
    select
      'discussion'::text as reason, null::bigint as page_id, recent.id as discussion_id,
      1 as new_count, null::bigint as first_post_id, opening.id as last_post_id,
      null::bigint as first_revision_id, null::bigint as last_revision_id
    from recent
    join watched on watched.page_id = recent.page_id
    join private.discussion_posts as opening
      on opening.discussion_id = recent.id and opening.kind = 'open'
    where opening.hidden_at is null
      and recent.created_at > watched.watched_at
      and recent.created_at > now() - interval '30 days'
      and not exists (select 1 from mine where mine.discussion_id = recent.id)
  ),
  edits as (
    select
      'edit'::text as reason, watched.page_id, null::bigint as discussion_id,
      coalesce(nullif(count(*) filter (where revision.created_at > mark.seen_at), 0), count(*))::integer
        as new_count,
      null::bigint as first_post_id, null::bigint as last_post_id,
      coalesce(min(revision.id) filter (where revision.created_at > mark.seen_at), min(revision.id))
        as first_revision_id,
      max(revision.id) as last_revision_id
    from mark, watched
    join public.revisions as revision on revision.page_id = watched.page_id
    join private.revision_authors as author on author.revision_id = revision.id
    where revision.created_at > watched.watched_at
      and revision.created_at > now() - interval '30 days'
      and revision.hidden_at is null
      and author.member_id <> p_member_id
      and revision.id > watched.my_last_revision_id
    group by watched.page_id
  )
  select
    item.reason, page.title, item.discussion_id, discussion.title, item.new_count, item.first_post_id,
    first_revision.parent_revision_id, item.last_revision_id,
    coalesce(last_post.author_name, last_revision.author_pseudonym),
    coalesce(last_post.created_at, last_revision.created_at),
    coalesce(last_post.created_at, last_revision.created_at) > mark.seen_at
  from mark, (
    select * from replies union all select * from opened union all select * from edits
  ) as item
  left join recent as discussion on discussion.id = item.discussion_id
  join public.pages as page on page.id = coalesce(discussion.page_id, item.page_id)
  left join private.discussion_posts as last_post on last_post.id = item.last_post_id
  left join public.revisions as last_revision on last_revision.id = item.last_revision_id
  left join public.revisions as first_revision on first_revision.id = item.first_revision_id
  order by coalesce(last_post.created_at, last_revision.created_at) desc
  limit 50;
$function$;

CREATE OR REPLACE FUNCTION public.count_page_watchers (
  p_page_id bigint
)
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not private.can_read() then
    raise exception 'membership verification required' using errcode = '42501';
  end if;
  return (select count(*)::integer from private.watched_pages as watch where watch.page_id = p_page_id);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."count_page_watchers"(bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.count_unread_notifications()
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.current_member_id();
begin
  if v_member_id is null then
    raise exception 'membership verification required' using errcode = '42501';
  end if;
  return (
    select count(*)::integer from private.notifications_for(v_member_id) as item where item.unread
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."count_unread_notifications"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_page_view (
  p_title           text,
  p_follow_redirect boolean DEFAULT true,
  p_revision_id     bigint  DEFAULT NULL::bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  v_title text := private.normalize_title(p_title);
  v_page public.pages;
  v_target public.pages;
  v_seen bigint[];
  v_redirected_from text;
  v_revision public.revisions;
  v_redirect_title text;
  v_redirect jsonb;
begin
  -- 회원 확인이 지난 사용자는 RLS 때문에 모든 문서가 "없는 문서"로 보인다. 그렇게 답하면 화면이
  -- 문서를 만들라고 안내하게 되므로, 권한 오류로 알려 로그인 화면으로 보내게 한다.
  if not private.can_read() then
    raise exception 'membership verification required' using errcode = '42501';
  end if;

  select * into v_page from public.pages as page where page.title_key = lower(v_title);

  if v_page.id is not null and p_follow_redirect and p_revision_id is null then
    v_seen := array[v_page.id];
    for hop in 1..3 loop
      exit when v_page.redirect_key is null;
      -- 삭제된 문서는 없는 문서로 친다(관리자에게는 RLS가 삭제된 문서도 보여 준다).
      select * into v_target from public.pages as page
      where page.title_key = v_page.redirect_key and page.deleted_at is null;
      exit when v_target.id is null or v_target.id = any(v_seen);
      v_seen := v_seen || v_target.id;
      v_redirected_from := coalesce(v_redirected_from, v_page.title);
      v_page := v_target;
    end loop;
  end if;

  if v_page.id is null then
    return jsonb_build_object(
      'found', false,
      'title', v_title,
      'valid_title', private.is_valid_title(v_title),
      'can_edit', private.can_edit(),
      'is_admin', private.is_admin(),
      -- 없는 문서도 누가 가리키는지 보여 준다(빨간 링크를 채울 사람에게 맥락이 된다).
      'backlinks', public.page_backlinks(lower(v_title))
    );
  end if;

  select * into v_revision from public.revisions as revision
  where revision.id = coalesce(p_revision_id, v_page.current_revision_id)
    and revision.page_id = v_page.id;

  -- 보여 줄 판의 넘겨주기. 예전 판을 볼 때는 그 판의 대상이다. 본문 전체를 훑는 `extract_refs`
  -- 대신 속성 하나만 읽는다(판정 기준은 같다).
  v_redirect_title := private.normalize_title(v_revision.body -> 'attrs' ->> 'redirect');
  if private.is_valid_title(v_redirect_title) then
    select * into v_target from public.pages as page
    where page.title_key = lower(v_redirect_title) and page.deleted_at is null;
    v_redirect := jsonb_build_object(
      'target', coalesce(v_target.title, v_redirect_title),
      'state', case
        when v_target.id is null then 'missing'
        when v_target.redirect_key is not null then 'redirect'
        else 'ok'
      end,
      'next', v_target.redirect_target
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'title', v_page.title,
    'redirected_from', v_redirected_from,
    'redirect', v_redirect,
    'can_edit', private.can_edit(),
    'is_admin', private.is_admin(),
    'page', jsonb_build_object(
      'id', v_page.id,
      'title', v_page.title,
      'namespace', v_page.namespace,
      'protection', v_page.protection,
      'redirect_target', v_page.redirect_target,
      'current_revision_id', v_page.current_revision_id,
      'updated_at', v_page.updated_at,
      'deleted_at', v_page.deleted_at
    ),
    'revision', case when v_revision.id is null then null else jsonb_build_object(
      'id', v_revision.id,
      'body', v_revision.body,
      'created_at', v_revision.created_at,
      'is_current', v_revision.id = v_page.current_revision_id
    ) end,
    'resolved', public.resolve_body(coalesce(v_revision.body, private.empty_doc())),
    'images', public.resolve_images(coalesce(v_revision.body, private.empty_doc())),
    'backlinks', public.page_backlinks(v_page.title_key),
    -- 문서의 토론 단추에 붙이는 수(`80-discussions`).
    'open_discussions', public.count_open_discussions(v_page.id),
    -- 문서의 별표(`90-notifications`).
    'watched', public.is_page_watched(v_page.id),
    'watchers', public.count_page_watchers(v_page.id),
    'children', coalesce((
      select jsonb_agg(child.title order by child.title)
      from public.pages as child
      where child.parent_key = v_page.title_key and child.deleted_at is null
    ), '[]'::jsonb),
    -- 분류 문서는 속한 문서를, 틀 문서는 쓰는 문서를 보여 준다.
    'members', case when v_page.namespace in ('category', 'template') then coalesce((
      select jsonb_agg(member.title order by member.title)
      from public.page_refs as ref
      join public.pages as member on member.id = ref.from_page_id
      where ref.kind = v_page.namespace
        and ref.target_key = v_page.title_key
        and member.deleted_at is null
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_page_watched (
  p_page_id bigint
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1 from private.watched_pages as watch
    where watch.member_id = private.current_member_id() and watch.page_id = p_page_id
  );
$function$;

REVOKE ALL ON FUNCTION "public"."is_page_watched"(bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_watched_pages()
  RETURNS TABLE (
    page_id      bigint,
    page_title   text,
    watched_at   timestamp with time zone,
    page_deleted boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.current_member_id();
begin
  if v_member_id is null then
    raise exception 'membership verification required' using errcode = '42501';
  end if;
  return query
  select page.id, page.title, watch.created_at, page.deleted_at is not null
  from private.watched_pages as watch
  join public.pages as page on page.id = watch.page_id
  where watch.member_id = v_member_id
  order by page.title;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_watched_pages"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.read_notifications()
  RETURNS TABLE (
    reason           text,
    page_title       text,
    discussion_id    bigint,
    discussion_title text,
    new_count        integer,
    first_post_id    bigint,
    from_revision_id bigint,
    to_revision_id   bigint,
    author_name      text,
    last_at          timestamp with time zone,
    unread           boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.current_member_id();
begin
  if v_member_id is null then
    raise exception 'membership verification required' using errcode = '42501';
  end if;

  return query
  select * from private.notifications_for(v_member_id) as item order by item.last_at desc;

  insert into private.notification_marks as mark (member_id, seen_at)
  values (v_member_id, now())
  on conflict on constraint notification_marks_pkey do update set seen_at = excluded.seen_at;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."read_notifications"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_page_watched (
  p_page_id bigint,
  p_watched boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.current_member_id();
begin
  if v_member_id is null then
    raise exception 'membership verification required' using errcode = '42501';
  end if;
  if not coalesce(p_watched, false) then
    delete from private.watched_pages where member_id = v_member_id and page_id = p_page_id;
    return;
  end if;
  if not exists (select 1 from public.pages where id = p_page_id) then
    raise exception 'page not found' using errcode = 'WK006';
  end if;
  insert into private.watched_pages (member_id, page_id) values (v_member_id, p_page_id)
  on conflict on constraint watched_pages_pkey do nothing;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_page_watched"(bigint, boolean) FROM PUBLIC, "anon";

ALTER TABLE "private"."notification_marks"
  ADD CONSTRAINT "notification_marks_member_id_fkey" FOREIGN KEY (member_id) REFERENCES private.members(id) ON DELETE CASCADE;

ALTER TABLE "private"."watched_pages"
  ADD CONSTRAINT "watched_pages_member_id_fkey" FOREIGN KEY (member_id) REFERENCES private.members(id) ON DELETE CASCADE;

ALTER TABLE "private"."watched_pages"
  ADD CONSTRAINT "watched_pages_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;

CREATE INDEX watched_pages_page_idx ON private.watched_pages USING btree (page_id);

REVOKE ALL ON FUNCTION "private"."notifications_for"(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."count_page_watchers"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."count_page_watchers"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_page_watchers"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_page_watchers"(bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."count_unread_notifications"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."count_unread_notifications"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_unread_notifications"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_unread_notifications"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_page_watched"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."is_page_watched"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_page_watched"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_page_watched"(bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_watched_pages"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_watched_pages"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_watched_pages"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_watched_pages"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."read_notifications"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."read_notifications"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."read_notifications"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."read_notifications"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_page_watched"(bigint, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_page_watched"(bigint, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_page_watched"(bigint, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_page_watched"(bigint, boolean) TO "service_role";
