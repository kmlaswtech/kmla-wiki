-- 선언적 스키마 정본. 이 파일을 먼저 고치고 `pnpm db:diff <이름>`으로 migration 초안을 만든 뒤 검토한다.
--
-- 즐겨찾기와 알림. 회원은 문서에 별표를 눌러 즐겨찾기에 더한다. 즐겨찾기한 문서가 편집되거나 그 문서에 새
-- 토론이 열리면, 그리고 내가 글을 쓴 토론에 새 글이 오면 알린다. 편집했다고 즐겨찾기에 들어가지는 않는다.
-- 알림은 저장하지 않고 판 기록과 토론 글에서 읽을 때마다 고른다. 그래서 판이나 글을 숨기면 알림도
-- 곧바로 사라진다. 회원마다 저장하는 것은 즐겨찾기와 알림을 마지막으로 본 시각뿐이다.

SET check_function_bodies = false;

-- 알림 화면을 마지막으로 연 시각. 그 뒤의 알림을 "읽지 않음"으로 센다.
CREATE TABLE "private"."notification_marks" (
  "member_id" bigint                   NOT NULL,
  "seen_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notification_marks_pkey" PRIMARY KEY (member_id),
  CONSTRAINT "notification_marks_member_id_fkey" FOREIGN KEY (member_id) REFERENCES private.members(id) ON DELETE CASCADE
);

ALTER TABLE "private"."notification_marks"
  ENABLE ROW LEVEL SECURITY;

-- 즐겨찾기. 본인만 안다. 다른 회원이나 관리자에게 돌려주는 RPC가 없다.
CREATE TABLE "private"."watched_pages" (
  "member_id"  bigint                   NOT NULL,
  "page_id"    bigint                   NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "watched_pages_pkey" PRIMARY KEY (member_id, page_id),
  CONSTRAINT "watched_pages_member_id_fkey" FOREIGN KEY (member_id) REFERENCES private.members(id) ON DELETE CASCADE,
  CONSTRAINT "watched_pages_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE
);

ALTER TABLE "private"."watched_pages"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX watched_pages_page_idx ON private.watched_pages USING btree (page_id);

-- 한 회원의 알림, 최근 것부터 50개. 최근 30일의 판과 글만 본다.
--   * edit: 즐겨찾기한 문서를 남이 편집했다. 문서 하나에 알림 하나다. 즐겨찾기에 더한 뒤, 그리고 내가 그 문서를
--     마지막으로 편집한 뒤의 판만 센다. 숨긴 판과 삭제된 문서는 뺀다. `from_revision_id`와
--     `to_revision_id`는 비교 화면의 양 끝이다.
--   * discussion: 즐겨찾기한 문서에 즐겨찾기한 뒤 열린 토론. 첫 글을 숨긴 토론은 빼고, 내가 글을 쓴
--     토론이면 reply만 낸다.
--   * reply: 내가 글을 쓴 토론에서 내 마지막 글 뒤에 남이 쓴 글. 토론 하나에 알림 하나다. 거두거나 숨긴
--     글은 세지 않는다. 내 글도 거두거나 숨긴 것과 관리자의 제목 바꾸기 글은 참여로 치지 않는다.
-- 토론은 모든 회원에게 보이는 것만 알린다(`discussion_is_public`, 관리자에게도). edit와 reply는 읽지 않은
-- 판·글이 있으면 `new_count`와 첫 판·글이 그것만 가리키고, 모두 읽었으면 전체를 가리킨다.
-- `author_name`과 `last_at`은 알림의 마지막 판·글(discussion이면 첫 글)의 이름과 시각이다. 이름은 그
-- 문서의 가명이거나 관리자 이름(`관리자 B`)이다. `unread`는 알림 화면을 마지막으로 연 뒤에 온 알림이다.
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

REVOKE ALL ON FUNCTION "private"."notifications_for"(bigint) FROM PUBLIC;

-- 알림 화면을 마지막으로 연 뒤에 온 알림 수. 머리띠가 센다. 알림 화면에 보이는 50개 안에서 센다.
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

GRANT EXECUTE ON FUNCTION "public"."count_unread_notifications"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."count_unread_notifications"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."count_unread_notifications"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_unread_notifications"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."count_unread_notifications"() FROM PUBLIC, "anon";

-- 알림을 읽는다. 최근 것부터 50개를 돌려주고, 본 시각을 지금으로 바꾼다. `unread`는 바꾸기 전의 본
-- 시각으로 정한다.
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

GRANT EXECUTE ON FUNCTION "public"."read_notifications"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."read_notifications"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."read_notifications"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."read_notifications"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."read_notifications"() FROM PUBLIC, "anon";

-- ── 즐겨찾기 ────────────────────────────────────────────────────────────────

-- 이 문서가 내가 즐겨찾기한 문서인가. 문서 보기(`get_page_view`)가 별표에 쓴다.
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

GRANT EXECUTE ON FUNCTION "public"."is_page_watched"(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."is_page_watched"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_page_watched"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_page_watched"(bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."is_page_watched"(bigint) FROM PUBLIC, "anon";

-- 이 문서를 즐겨찾기한 회원 수. 문서 보기(`get_page_view`)가 별표 옆에 쓴다. 누가 했는지는 돌려주지
-- 않는다.
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

GRANT EXECUTE ON FUNCTION "public"."count_page_watchers"(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."count_page_watchers"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."count_page_watchers"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_page_watchers"(bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."count_page_watchers"(bigint) FROM PUBLIC, "anon";

-- 문서를 즐겨찾기에 더하거나 뺀다. 읽을 수 있는 회원이면 차단 중에도 된다. 있는 문서는 모두 더할 수
-- 있다(삭제된 문서도). 없는 문서는 WK006이다. 이미 그 상태면 아무것도 하지 않는다.
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

GRANT EXECUTE ON FUNCTION "public"."set_page_watched"(bigint, boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_page_watched"(bigint, boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_page_watched"(bigint, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_page_watched"(bigint, boolean) TO "postgres";

REVOKE ALL ON FUNCTION "public"."set_page_watched"(bigint, boolean) FROM PUBLIC, "anon";

-- 내 즐겨찾기, 제목순. 삭제된 문서도 보인다(`page_deleted`). 삭제된 문서는 알림을 내지 않는다.
CREATE OR REPLACE FUNCTION public.list_watched_pages()
  RETURNS TABLE (
    page_id    bigint,
    page_title text,
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

GRANT EXECUTE ON FUNCTION "public"."list_watched_pages"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_watched_pages"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_watched_pages"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_watched_pages"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_watched_pages"() FROM PUBLIC, "anon";
