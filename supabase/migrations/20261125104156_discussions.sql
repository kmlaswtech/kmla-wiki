-- 문서별 토론(private.discussions, private.discussion_posts)과 읽기·쓰기 RPC. 관리 기록에 토론 동작과
-- discussion_id 열을 더한다. 새 오류 코드:
--   WK022  닫힌 토론에는 글을 쓸 수 없다(다시 열기로 쓴다)
--   WK023  이 차례가 열린 지 24시간이 지나지 않아 닫을 수 없다
--   WK024  거둘 수 없다. detail = 'replies'(뒤에 글이 있음), 'kind'(첫 글·닫기·다시 열기 글)
-- 같이 쓰는 코드: WK005 detail 'post'·'title'·'rate', WK014 detail 'post'·'conclusion'·'title'(비었거나 짧음).

SET local check_function_bodies = off;

ALTER TABLE "public"."admin_log"
  DROP CONSTRAINT "admin_log_action";

DROP FUNCTION "private"."log_admin_action"(text, text, text, bigint, text, text);

CREATE TABLE "private"."discussion_posts" (
  "id"            bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "discussion_id" bigint                   NOT NULL,
  "kind"          text                     NOT NULL,
  "member_id"     bigint,
  "author_name"   text                     NOT NULL,
  "as_admin"      boolean                  NOT NULL DEFAULT false,
  "body"          text                     NOT NULL,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "withdrawn_at"  timestamp with time zone,
  "hidden_at"     timestamp with time zone,
  CONSTRAINT "discussion_posts_body" CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000))),
  CONSTRAINT "discussion_posts_kind" CHECK ((kind = ANY (ARRAY['open'::text, 'post'::text, 'close'::text, 'reopen'::text, 'rename'::text]))),
  CONSTRAINT "discussion_posts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "private"."discussion_posts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."discussions" (
  "id"                   bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "page_id"              bigint                   NOT NULL,
  "title"                text                     NOT NULL,
  "revision_id"          bigint,
  "created_by_member_id" bigint,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "opened_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "opened_by_member_id"  bigint,
  "closed_at"            timestamp with time zone,
  "last_post_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "withdrawn_at"         timestamp with time zone,
  "deleted_at"           timestamp with time zone,
  CONSTRAINT "discussions_pkey" PRIMARY KEY (id),
  CONSTRAINT "discussions_title" CHECK (((title = btrim(title)) AND ((char_length(title) >= 1) AND (char_length(title) <= 80))))
);

ALTER TABLE "private"."discussions"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."admin_log"
  ADD COLUMN "discussion_id" bigint;

CREATE OR REPLACE FUNCTION private.can_see_discussion (
  p_discussion private.discussions
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select private.discussion_is_public(p_discussion)
    or (p_discussion.withdrawn_at is null and private.is_admin());
$function$;

CREATE OR REPLACE FUNCTION private.check_discussion_body (
  p_body text,
  p_min  integer
)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  v_body text := btrim(replace(coalesce(p_body, ''), E'\r\n', E'\n'), E' \t\n\r');
begin
  if char_length(v_body) > 4000 then
    raise exception 'post too long' using errcode = 'WK005', detail = 'post';
  end if;
  if char_length(v_body) < greatest(p_min, 1) then
    raise exception 'post too short' using errcode = 'WK014', detail = case when p_min > 1 then 'conclusion' else 'post' end;
  end if;
  return v_body;
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_discussion_rate (
  p_member_id bigint,
  p_opening   boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform 1 from private.members where id = p_member_id for update;
  if private.is_admin() then
    return;
  end if;
  if p_opening then
    if (
      select count(*) from private.discussions as discussion
      where discussion.created_by_member_id = p_member_id
        and discussion.created_at > now() - interval '1 hour'
    ) >= 5 then
      raise exception 'too many discussions' using errcode = 'WK005', detail = 'rate';
    end if;
  elsif (
    select count(*) from private.discussion_posts as post
    where post.member_id = p_member_id
      and post.created_at > now() - interval '10 minutes'
  ) >= 20 then
    raise exception 'too many posts' using errcode = 'WK005', detail = 'rate';
  end if;
end;
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
    return '관리자';
  end if;
  return private.pseudonym_for(p_page_id, p_member_id);
end;
$function$;

CREATE OR REPLACE FUNCTION private.discussion_close_delay()
  RETURNS interval
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select interval '24 hours';
$function$;

CREATE OR REPLACE FUNCTION private.discussion_is_public (
  p_discussion private.discussions
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select p_discussion.withdrawn_at is null
    and p_discussion.deleted_at is null
    and exists (select 1 from public.pages where id = p_discussion.page_id and deleted_at is null);
$function$;

CREATE OR REPLACE FUNCTION private.discussion_version (
  p_discussion private.discussions
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select md5(concat_ws('|',
    p_discussion.title, p_discussion.closed_at, p_discussion.deleted_at, p_discussion.opened_at,
    (select string_agg(concat_ws(',', post.id, post.withdrawn_at, post.hidden_at), ';' order by post.id)
      from private.discussion_posts as post where post.discussion_id = p_discussion.id)
  ));
$function$;

CREATE OR REPLACE FUNCTION private.insert_discussion_post (
  p_discussion private.discussions,
  p_member_id  bigint,
  p_kind       text,
  p_body       text,
  p_as_admin   boolean
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_post_id bigint;
begin
  insert into private.discussion_posts (discussion_id, kind, member_id, author_name, as_admin, body)
  values (
    p_discussion.id, p_kind, p_member_id,
    private.discussion_author_name(p_discussion.page_id, p_member_id, p_as_admin),
    coalesce(p_as_admin, false), p_body
  )
  returning id into v_post_id;

  update private.discussions set last_post_at = now() where id = p_discussion.id;
  return v_post_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.lock_discussion (
  p_discussion_id bigint
)
  RETURNS private.discussions
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_discussion private.discussions;
begin
  select * into v_discussion from private.discussions where id = p_discussion_id for update;
  if v_discussion.id is null or v_discussion.withdrawn_at is not null or v_discussion.deleted_at is not null then
    raise exception 'discussion not found' using errcode = 'WK006';
  end if;
  if exists (select 1 from public.pages where id = v_discussion.page_id and deleted_at is not null) then
    raise exception 'page deleted' using errcode = 'WK008';
  end if;
  return v_discussion;
end;
$function$;

CREATE OR REPLACE FUNCTION private.log_admin_action (
  p_action        text,
  p_reason        text,
  p_page_title    text   DEFAULT NULL::text,
  p_revision_id   bigint DEFAULT NULL::bigint,
  p_pseudonym     text   DEFAULT NULL::text,
  p_note          text   DEFAULT NULL::text,
  p_discussion_id bigint DEFAULT NULL::bigint
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_log_id bigint;
begin
  insert into public.admin_log (action, page_title, revision_id, pseudonym, reason, note, discussion_id)
  values (p_action, p_page_title, p_revision_id, p_pseudonym, p_reason, p_note, p_discussion_id)
  returning id into v_log_id;

  insert into private.admin_actions (admin_log_id, actor_member_id)
  values (v_log_id, private.current_member_id());

  return v_log_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_discussion_post (
  p_discussion_id bigint,
  p_body          text,
  p_as_admin      boolean DEFAULT false
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_body text := private.check_discussion_body(p_body, 1);
  v_discussion private.discussions := private.lock_discussion(p_discussion_id);
begin
  if v_discussion.closed_at is not null then
    raise exception 'discussion closed' using errcode = 'WK022';
  end if;
  perform private.check_discussion_rate(v_member_id, false);
  return private.insert_discussion_post(v_discussion, v_member_id, 'post', v_body, p_as_admin);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."add_discussion_post"(bigint, text, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.close_discussion (
  p_discussion_id bigint,
  p_body          text,
  p_as_admin      boolean DEFAULT false
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_body text := private.check_discussion_body(p_body, 10);
  v_discussion private.discussions := private.lock_discussion(p_discussion_id);
  v_early boolean;
  v_post_id bigint;
begin
  if v_discussion.closed_at is not null then
    raise exception 'already closed' using errcode = 'WK011';
  end if;
  v_early := now() < v_discussion.opened_at + private.discussion_close_delay()
    and v_discussion.opened_by_member_id is distinct from v_member_id;
  if v_early and not coalesce(p_as_admin, false) then
    raise exception 'too early to close' using errcode = 'WK023';
  end if;

  perform private.check_discussion_rate(v_member_id, false);
  v_post_id := private.insert_discussion_post(v_discussion, v_member_id, 'close', v_body, p_as_admin);
  update private.discussions set closed_at = now() where id = v_discussion.id;

  if v_early then
    -- 사유에는 결론 글을 옮겨 적지 않고 가리키기만 한다. 관리 기록은 모든 회원이 보고 지울 수 없으므로,
    -- 나중에 그 글을 숨겨도 기록에 남지 않게 한다. 토론 제목도 같은 까닭으로 적지 않는다.
    perform private.log_admin_action(
      'close_discussion_early', '결론 글 #' || v_post_id,
      (select title from public.pages where id = v_discussion.page_id), p_discussion_id => v_discussion.id
    );
  end if;
  return v_post_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."close_discussion"(bigint, text, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.count_open_discussions (
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
  return (
    select count(*)::integer from private.discussions as discussion
    where discussion.page_id = p_page_id
      and discussion.closed_at is null
      and discussion.deleted_at is null
      and discussion.withdrawn_at is null
      -- `can_see_discussion`과 같은 판단이다. 행마다 함수를 부르지 않도록 풀어 썼다. 이 조건은 행을
      -- 가리키지 않아 한 번만 계산된다. 문서 보기마다 부르므로 가볍게 둔다.
      and (private.is_admin() or exists (select 1 from public.pages where id = p_page_id and deleted_at is null))
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."count_open_discussions"(bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_discussion (
  p_discussion_id bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.current_member_id();
  v_is_admin boolean := private.is_admin();
  v_discussion private.discussions;
  v_page public.pages;
begin
  if v_member_id is null then
    raise exception 'membership verification required' using errcode = '42501';
  end if;
  select * into v_discussion from private.discussions where id = p_discussion_id;
  if v_discussion.id is null or not private.can_see_discussion(v_discussion) then
    raise exception 'discussion not found' using errcode = 'WK006';
  end if;
  select * into v_page from public.pages where id = v_discussion.page_id;

  return jsonb_build_object(
    'id', v_discussion.id,
    'page_id', v_page.id,
    'page_title', v_page.title,
    'title', v_discussion.title,
    'revision_id', v_discussion.revision_id,
    'is_open', v_discussion.closed_at is null,
    'created_at', v_discussion.created_at,
    'closed_at', v_discussion.closed_at,
    'close_after', v_discussion.opened_at + private.discussion_close_delay(),
    'opened_by_me', v_discussion.opened_by_member_id = v_member_id,
    'created_by_me', v_discussion.created_by_member_id = v_member_id,
    'deleted', v_discussion.deleted_at is not null,
    'version', private.discussion_version(v_discussion),
    'posts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', post.id,
          'kind', post.kind,
          'author_name', post.author_name,
          'as_admin', post.as_admin,
          'state', case
            when post.withdrawn_at is not null then 'withdrawn'
            when post.hidden_at is not null then 'hidden'
            else 'visible'
          end,
          'body', case
            when (post.withdrawn_at is null and post.hidden_at is null) or v_is_admin then post.body
          end,
          'created_at', post.created_at,
          'mine', post.member_id = v_member_id
        )
        order by post.id
      )
      from private.discussion_posts as post
      where post.discussion_id = v_discussion.id
    ), '[]'::jsonb)
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."get_discussion"(bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_discussion_version (
  p_discussion_id bigint
)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_discussion private.discussions;
begin
  if not private.can_read() then
    raise exception 'membership verification required' using errcode = '42501';
  end if;
  select * into v_discussion from private.discussions where id = p_discussion_id;
  if v_discussion.id is null or not private.can_see_discussion(v_discussion) then
    return null;
  end if;
  return private.discussion_version(v_discussion);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."get_discussion_version"(bigint) FROM PUBLIC, "anon";

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

CREATE OR REPLACE FUNCTION public.list_page_discussions (
  p_page_id bigint
)
  RETURNS TABLE (
    id           bigint,
    title        text,
    revision_id  bigint,
    is_open      boolean,
    opener_name  text,
    post_count   integer,
    created_at   timestamp with time zone,
    last_post_at timestamp with time zone,
    deleted      boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not private.can_read() then
    raise exception 'membership verification required' using errcode = '42501';
  end if;
  return query
  select
    discussion.id, discussion.title, discussion.revision_id, discussion.closed_at is null,
    (select post.author_name from private.discussion_posts as post
      where post.discussion_id = discussion.id and post.kind = 'open'),
    (select count(*)::integer from private.discussion_posts as post
      where post.discussion_id = discussion.id and post.withdrawn_at is null),
    discussion.created_at, discussion.last_post_at, discussion.deleted_at is not null
  from private.discussions as discussion
  where discussion.page_id = p_page_id and private.can_see_discussion(discussion)
  order by discussion.last_post_at desc, discussion.id desc;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_page_discussions"(bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_recent_discussions()
  RETURNS TABLE (
    id           bigint,
    title        text,
    page_title   text,
    is_open      boolean,
    opener_name  text,
    post_count   integer,
    last_post_at timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not private.can_read() then
    raise exception 'membership verification required' using errcode = '42501';
  end if;
  return query
  select
    discussion.id, discussion.title, page.title, discussion.closed_at is null,
    (select post.author_name from private.discussion_posts as post
      where post.discussion_id = discussion.id and post.kind = 'open'),
    (select count(*)::integer from private.discussion_posts as post
      where post.discussion_id = discussion.id and post.withdrawn_at is null),
    discussion.last_post_at
  from private.discussions as discussion
  join public.pages as page on page.id = discussion.page_id
  where private.discussion_is_public(discussion)
  order by discussion.last_post_at desc, discussion.id desc
  limit 100;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_recent_discussions"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.open_discussion (
  p_page_id     bigint,
  p_title       text,
  p_body        text,
  p_revision_id bigint  DEFAULT NULL::bigint,
  p_as_admin    boolean DEFAULT false
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_title text := btrim(coalesce(p_title, ''));
  v_body text;
  v_page public.pages;
  v_discussion private.discussions;
begin
  if coalesce(p_as_admin, false) and not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if char_length(v_title) < 1 then
    raise exception 'title required' using errcode = 'WK014', detail = 'title';
  end if;
  if char_length(v_title) > 80 then
    raise exception 'title too long' using errcode = 'WK005', detail = 'title';
  end if;
  v_body := private.check_discussion_body(p_body, 1);

  select * into v_page from public.pages where id = p_page_id;
  if v_page.id is null then
    raise exception 'page not found' using errcode = 'WK006';
  end if;
  if v_page.deleted_at is not null then
    raise exception 'page deleted' using errcode = 'WK008';
  end if;
  if p_revision_id is not null and not exists (
    select 1 from public.revisions
    where id = p_revision_id and page_id = p_page_id and hidden_at is null
  ) then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;

  perform private.check_discussion_rate(v_member_id, true);

  insert into private.discussions (page_id, title, revision_id, created_by_member_id, opened_by_member_id)
  values (p_page_id, v_title, p_revision_id, v_member_id, v_member_id)
  returning * into v_discussion;
  perform private.insert_discussion_post(v_discussion, v_member_id, 'open', v_body, p_as_admin);
  return v_discussion.id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."open_discussion"(bigint, text, text, bigint, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.rename_discussion (
  p_discussion_id bigint,
  p_title         text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint;
  v_title text := btrim(coalesce(p_title, ''));
  v_discussion private.discussions;
begin
  perform private.require_admin();
  v_member_id := private.current_member_id();
  if char_length(v_title) < 1 then
    raise exception 'title required' using errcode = 'WK014', detail = 'title';
  end if;
  if char_length(v_title) > 80 then
    raise exception 'title too long' using errcode = 'WK005', detail = 'title';
  end if;

  v_discussion := private.lock_discussion(p_discussion_id);
  if v_discussion.title = v_title then
    raise exception 'already in that state' using errcode = 'WK011';
  end if;

  update private.discussions set title = v_title where id = p_discussion_id;
  perform private.insert_discussion_post(
    v_discussion, v_member_id, 'rename',
    format('제목을 ‘%s’에서 ‘%s’(으)로 바꿨습니다.', v_discussion.title, v_title), true
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."rename_discussion"(bigint, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.reopen_discussion (
  p_discussion_id bigint,
  p_body          text,
  p_as_admin      boolean DEFAULT false
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_body text := private.check_discussion_body(p_body, 10);
  v_discussion private.discussions := private.lock_discussion(p_discussion_id);
  v_post_id bigint;
begin
  if v_discussion.closed_at is null then
    raise exception 'already open' using errcode = 'WK011';
  end if;

  perform private.check_discussion_rate(v_member_id, false);
  v_post_id := private.insert_discussion_post(v_discussion, v_member_id, 'reopen', v_body, p_as_admin);
  update private.discussions
     set closed_at = null, opened_at = now(), opened_by_member_id = v_member_id
   where id = v_discussion.id;
  return v_post_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."reopen_discussion"(bigint, text, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.revision_discussion_counts (
  p_page_id bigint
)
  RETURNS TABLE (
    revision_id      bigint,
    discussion_count integer
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not private.can_read() then
    raise exception 'membership verification required' using errcode = '42501';
  end if;
  return query
  select discussion.revision_id, count(*)::integer
  from private.discussions as discussion
  where discussion.page_id = p_page_id
    and discussion.revision_id is not null
    and discussion.deleted_at is null
    and private.can_see_discussion(discussion)
  group by discussion.revision_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."revision_discussion_counts"(bigint) FROM PUBLIC, "anon";

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

REVOKE ALL ON FUNCTION "public"."set_discussion_deleted"(bigint, boolean, text) FROM PUBLIC, "anon";

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

REVOKE ALL ON FUNCTION "public"."set_discussion_post_hidden"(bigint, boolean, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.withdraw_discussion (
  p_discussion_id bigint
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_discussion private.discussions := private.lock_discussion(p_discussion_id);
begin
  if v_discussion.created_by_member_id is distinct from v_member_id then
    raise exception 'not your discussion' using errcode = '42501';
  end if;
  if exists (
    select 1 from private.discussion_posts as reply
    where reply.discussion_id = v_discussion.id and reply.kind <> 'open' and reply.withdrawn_at is null
  ) then
    raise exception 'there are replies' using errcode = 'WK024', detail = 'replies';
  end if;

  update private.discussions set withdrawn_at = now() where id = v_discussion.id;
  return (select title from public.pages where id = v_discussion.page_id);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."withdraw_discussion"(bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.withdraw_discussion_post (
  p_post_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_post private.discussion_posts;
begin
  select * into v_post from private.discussion_posts where id = p_post_id;
  if v_post.id is null then
    raise exception 'post not found' using errcode = 'WK006';
  end if;
  -- 같은 토론의 글 쓰기와 한 줄로 세운다. 거두는 사이에 답글이 붙지 않게 한다.
  perform private.lock_discussion(v_post.discussion_id);

  if v_post.member_id is distinct from v_member_id then
    raise exception 'not your post' using errcode = '42501';
  end if;
  if v_post.withdrawn_at is not null then
    raise exception 'already withdrawn' using errcode = 'WK011';
  end if;
  if v_post.kind <> 'post' then
    raise exception 'this post cannot be withdrawn' using errcode = 'WK024', detail = 'kind';
  end if;
  if exists (
    select 1 from private.discussion_posts as later
    where later.discussion_id = v_post.discussion_id and later.id > v_post.id and later.withdrawn_at is null
  ) then
    raise exception 'there are replies' using errcode = 'WK024', detail = 'replies';
  end if;

  update private.discussion_posts set withdrawn_at = now() where id = p_post_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."withdraw_discussion_post"(bigint) FROM PUBLIC, "anon";

ALTER TABLE "private"."discussion_posts"
  ADD CONSTRAINT "discussion_posts_member_id_fkey" FOREIGN KEY (member_id) REFERENCES private.members(id) ON DELETE SET NULL;

ALTER TABLE "private"."discussions"
  ADD CONSTRAINT "discussions_created_by_member_id_fkey" FOREIGN KEY (created_by_member_id) REFERENCES private.members(id) ON DELETE SET NULL;

ALTER TABLE "private"."discussions"
  ADD CONSTRAINT "discussions_opened_by_member_id_fkey" FOREIGN KEY (opened_by_member_id) REFERENCES private.members(id) ON DELETE SET NULL;

ALTER TABLE "private"."discussions"
  ADD CONSTRAINT "discussions_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;

ALTER TABLE "private"."discussion_posts"
  ADD CONSTRAINT "discussion_posts_discussion_id_fkey" FOREIGN KEY (discussion_id) REFERENCES private.discussions(id) ON DELETE CASCADE;

ALTER TABLE "private"."discussions"
  ADD CONSTRAINT "discussions_revision_id_fkey" FOREIGN KEY (revision_id) REFERENCES public.revisions(id) ON DELETE SET NULL;

ALTER TABLE "public"."admin_log"
  ADD CONSTRAINT "admin_log_action"
    CHECK
    ((action = ANY (ARRAY['ban'::text, 'lift_ban'::text, 'grant_admin'::text, 'revoke_admin'::text, 'protect'::text, 'unprotect'::text, 'delete_page'::text, 'restore_page'::text,
    'hide_revision'::text,
    'unhide_revision'::text,
    'view_author_edits'::text,
    'change_ban'::text,
    'bulk_revert'::text,
    'restore_admin'::text, 'hide_discussion_post'::text, 'unhide_discussion_post'::text, 'delete_discussion'::text, 'restore_discussion'::text, 'close_discussion_early'::text])));

CREATE INDEX discussion_posts_discussion_idx ON private.discussion_posts USING btree (discussion_id, id);

CREATE INDEX discussion_posts_member_idx ON private.discussion_posts USING btree (member_id, created_at DESC);

CREATE INDEX discussions_created_by_idx ON private.discussions USING btree (created_by_member_id, created_at DESC);

CREATE INDEX discussions_page_idx ON private.discussions USING btree (page_id, last_post_at DESC);

CREATE INDEX discussions_recent_idx ON private.discussions USING btree (last_post_at DESC);

CREATE INDEX discussions_revision_idx ON private.discussions USING btree (revision_id)
  WHERE (revision_id IS NOT NULL);

REVOKE ALL ON FUNCTION "private"."can_see_discussion"(private.discussions) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."check_discussion_body"(text, integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."check_discussion_rate"(bigint, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."discussion_author_name"(bigint, bigint, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."discussion_close_delay"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."discussion_is_public"(private.discussions) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."discussion_version"(private.discussions) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."insert_discussion_post"(private.discussions, bigint, text, text, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."lock_discussion"(bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."log_admin_action"(text, text, text, bigint, text, text, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."add_discussion_post"(bigint, text, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."add_discussion_post"(bigint, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_discussion_post"(bigint, text, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_discussion_post"(bigint, text, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."close_discussion"(bigint, text, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."close_discussion"(bigint, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."close_discussion"(bigint, text, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."close_discussion"(bigint, text, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."count_open_discussions"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."count_open_discussions"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_open_discussions"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_open_discussions"(bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_discussion"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_discussion"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_discussion"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_discussion"(bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_discussion_version"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_discussion_version"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_discussion_version"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_discussion_version"(bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_page_discussions"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_page_discussions"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_page_discussions"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_page_discussions"(bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_recent_discussions"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_recent_discussions"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_recent_discussions"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_recent_discussions"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."open_discussion"(bigint, text, text, bigint, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."open_discussion"(bigint, text, text, bigint, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."open_discussion"(bigint, text, text, bigint, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."open_discussion"(bigint, text, text, bigint, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."rename_discussion"(bigint, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."rename_discussion"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."rename_discussion"(bigint, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."rename_discussion"(bigint, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."reopen_discussion"(bigint, text, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."reopen_discussion"(bigint, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."reopen_discussion"(bigint, text, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."reopen_discussion"(bigint, text, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."revision_discussion_counts"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."revision_discussion_counts"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."revision_discussion_counts"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."revision_discussion_counts"(bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_discussion_deleted"(bigint, boolean, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_discussion_deleted"(bigint, boolean, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_discussion_deleted"(bigint, boolean, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_discussion_deleted"(bigint, boolean, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_discussion_post_hidden"(bigint, boolean, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_discussion_post_hidden"(bigint, boolean, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_discussion_post_hidden"(bigint, boolean, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_discussion_post_hidden"(bigint, boolean, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."withdraw_discussion"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."withdraw_discussion"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."withdraw_discussion"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."withdraw_discussion"(bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."withdraw_discussion_post"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."withdraw_discussion_post"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."withdraw_discussion_post"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."withdraw_discussion_post"(bigint) TO "service_role";
