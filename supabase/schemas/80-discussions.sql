-- 선언적 스키마 정본. 이 파일을 먼저 고치고 `pnpm db:diff <이름>`으로 migration 초안을 만든 뒤 검토한다.
--
-- 토론. 문서마다 회원이 이야기하는 곳이다. 편집자는 문서마다 다른 가명이라 위키 밖에서 다툼을 풀 수
-- 없으므로, 문서 안에서 이야기하고 결론을 남긴다. 글은 평문이고 고칠 수 없다. 작성자 이름은 그 문서의
-- 가명이거나, 관리자가 "관리자로" 고르면 '관리자'다.
--
-- 표는 모두 private이고 읽기와 쓰기는 RPC로만 한다. 실제 작성자(member_id)를 돌려주지 않기 위해서다.

SET check_function_bodies = false;

-- 토론 하나. 열림과 닫힘은 `closed_at`으로 정한다. `opened_at`·`opened_by_member_id`는 지금 열린 차례를
-- 연 글(처음 열기 또는 다시 열기)의 시각과 사람이다. 닫기의 24시간 규칙이 쓴다.
CREATE TABLE "private"."discussions" (
  "id"                   bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "page_id"              bigint                   NOT NULL,
  "title"                text                     NOT NULL,
  -- 토론을 붙인 판. 판이 지워지면 붙임만 없어진다.
  "revision_id"          bigint,
  "created_by_member_id" bigint,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "opened_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "opened_by_member_id"  bigint,
  "closed_at"            timestamp with time zone,
  -- 최근 활동순 정렬. 글을 쓸 때마다 바꾼다.
  "last_post_at"         timestamp with time zone NOT NULL DEFAULT now(),
  -- 연 사람이 거둔 토론. 누구에게도 보이지 않는다.
  "withdrawn_at"         timestamp with time zone,
  -- 관리자가 지운 토론. 관리자에게만 보인다.
  "deleted_at"           timestamp with time zone,
  CONSTRAINT "discussions_pkey" PRIMARY KEY (id),
  CONSTRAINT "discussions_title" CHECK (((title = btrim(title)) AND ((char_length(title) >= 1) AND (char_length(title) <= 80)))),
  CONSTRAINT "discussions_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE,
  CONSTRAINT "discussions_revision_id_fkey" FOREIGN KEY (revision_id) REFERENCES public.revisions(id) ON DELETE SET NULL,
  CONSTRAINT "discussions_created_by_member_id_fkey" FOREIGN KEY (created_by_member_id) REFERENCES private.members(id) ON DELETE SET NULL,
  CONSTRAINT "discussions_opened_by_member_id_fkey" FOREIGN KEY (opened_by_member_id) REFERENCES private.members(id) ON DELETE SET NULL
);

ALTER TABLE "private"."discussions"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX discussions_page_idx ON private.discussions USING btree (page_id, last_post_at DESC);

-- 판별 토론 수(`revision_discussion_counts`)와 판 삭제의 set null이 쓴다.
CREATE INDEX discussions_revision_idx ON private.discussions USING btree (revision_id)
  WHERE (revision_id IS NOT NULL);

-- 최근 토론(`list_recent_discussions`). 위키 전체의 토론을 최근 활동순으로 읽는다.
CREATE INDEX discussions_recent_idx ON private.discussions USING btree (last_post_at DESC);

-- 한 사람이 1시간에 연 토론 수.
CREATE INDEX discussions_created_by_idx ON private.discussions USING btree (created_by_member_id, created_at DESC);

-- 토론 글. `open`은 토론의 첫 글, `close`·`reopen`은 닫기·다시 열기와 함께 쓴 글(결론, 다시 여는 까닭),
-- `rename`은 관리자가 제목을 바꿀 때 서버가 남기는 글이다.
CREATE TABLE "private"."discussion_posts" (
  "id"            bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "discussion_id" bigint                   NOT NULL,
  "kind"          text                     NOT NULL,
  "member_id"     bigint,
  -- 쓰는 순간 정한 이름. 그 문서의 가명이거나 '관리자'다.
  "author_name"   text                     NOT NULL,
  "as_admin"      boolean                  NOT NULL DEFAULT false,
  "body"          text                     NOT NULL,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  -- 작성자가 거둔 글.
  "withdrawn_at"  timestamp with time zone,
  -- 관리자가 숨긴 글.
  "hidden_at"     timestamp with time zone,
  CONSTRAINT "discussion_posts_pkey" PRIMARY KEY (id),
  CONSTRAINT "discussion_posts_kind" CHECK ((kind = ANY (ARRAY['open'::text, 'post'::text, 'close'::text, 'reopen'::text, 'rename'::text]))),
  CONSTRAINT "discussion_posts_body" CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000))),
  CONSTRAINT "discussion_posts_discussion_id_fkey" FOREIGN KEY (discussion_id) REFERENCES private.discussions(id) ON DELETE CASCADE,
  CONSTRAINT "discussion_posts_member_id_fkey" FOREIGN KEY (member_id) REFERENCES private.members(id) ON DELETE SET NULL
);

ALTER TABLE "private"."discussion_posts"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX discussion_posts_discussion_idx ON private.discussion_posts USING btree (discussion_id, id);

-- 한 사람이 10분에 쓴 글 수.
CREATE INDEX discussion_posts_member_idx ON private.discussion_posts USING btree (member_id, created_at DESC);

-- ── 내부 도우미 ──────────────────────────────────────────────────────────────

-- 닫은 뒤, 다시 연 뒤 이 시간 안에는 닫을 수 없다. 그 차례를 연 사람과 '관리자로' 닫는 관리자는 예외다.
CREATE OR REPLACE FUNCTION private.discussion_close_delay()
  RETURNS interval
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select interval '24 hours';
$function$;

REVOKE ALL ON FUNCTION "private"."discussion_close_delay"() FROM PUBLIC;

-- 글 본문을 다듬고 검사한다. 줄바꿈을 `\n`으로 맞추고 앞뒤 공백을 지운다. `p_min`은 최소 글자 수다
-- (보통 1, 닫기·다시 열기는 10).
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

REVOKE ALL ON FUNCTION "private"."check_discussion_body"(text, integer) FROM PUBLIC;

-- 글쓴이 이름. "관리자로"는 관리자만 고를 수 있다.
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

REVOKE ALL ON FUNCTION "private"."discussion_author_name"(bigint, bigint, boolean) FROM PUBLIC;

-- 도배 제한. 같은 사람의 쓰기를 한 줄로 세운 뒤 센다. 관리자는 세지 않는다.
-- `p_opening`이면 1시간에 연 토론 수(5개)를, 아니면 10분에 쓴 글 수(20개)를 본다.
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

REVOKE ALL ON FUNCTION "private"."check_discussion_rate"(bigint, boolean) FROM PUBLIC;

-- 쓰기 전에 토론을 잠그고 돌려준다. 거둔 토론, 지운 토론, 없는 토론은 WK006, 삭제된 문서의 토론은
-- WK008이다.
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

REVOKE ALL ON FUNCTION "private"."lock_discussion"(bigint) FROM PUBLIC;

-- 글 하나를 쓰고 토론의 최근 활동 시각을 바꾼다. 검사와 잠금은 부르는 쪽이 한다.
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

REVOKE ALL ON FUNCTION "private"."insert_discussion_post"(private.discussions, bigint, text, text, boolean) FROM PUBLIC;

-- 모든 회원에게 보이는 토론인가. 거두지 않았고, 지우지 않았고, 문서가 삭제되지 않았다. 최근 토론 목록은
-- 관리자에게도 이것만 보인다.
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

REVOKE ALL ON FUNCTION "private"."discussion_is_public"(private.discussions) FROM PUBLIC;

-- 지금 사용자가 이 토론을 볼 수 있는가. 거둔 토론은 아무도, 지운 토론과 삭제된 문서의 토론은
-- 관리자만 본다.
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

REVOKE ALL ON FUNCTION "private"."can_see_discussion"(private.discussions) FROM PUBLIC;

-- 토론 화면이 보이는 것이 바뀌었는지 가리는 표. 제목, 열림·닫힘, 지움, 글의 추가·거둠·숨김이 바뀌면
-- 달라진다. 토론 화면은 5초마다 이것만 묻고, 달라졌을 때만 토론 전체를 다시 읽는다.
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

REVOKE ALL ON FUNCTION "private"."discussion_version"(private.discussions) FROM PUBLIC;

-- ── 쓰기 ─────────────────────────────────────────────────────────────────────

-- 토론을 연다. 있는 문서면 보호 문서도 된다. 판에 붙이려면 그 문서의 숨기지 않은 판이어야 한다.
-- 새 토론 id를 돌려준다.
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

GRANT EXECUTE ON FUNCTION "public"."open_discussion"(bigint, text, text, bigint, boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."open_discussion"(bigint, text, text, bigint, boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."open_discussion"(bigint, text, text, bigint, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."open_discussion"(bigint, text, text, bigint, boolean) TO "postgres";

REVOKE ALL ON FUNCTION "public"."open_discussion"(bigint, text, text, bigint, boolean) FROM PUBLIC, "anon";

-- 열린 토론에 글을 쓴다. 닫힌 토론에는 다시 열기로만 쓴다(WK022). 새 글 id를 돌려준다.
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

GRANT EXECUTE ON FUNCTION "public"."add_discussion_post"(bigint, text, boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."add_discussion_post"(bigint, text, boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."add_discussion_post"(bigint, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_discussion_post"(bigint, text, boolean) TO "postgres";

REVOKE ALL ON FUNCTION "public"."add_discussion_post"(bigint, text, boolean) FROM PUBLIC, "anon";

-- 토론을 닫는다. 10자 이상의 글(결론)을 함께 쓴다. 이 차례가 열린 지 24시간이 지나야 닫을 수 있다
-- (WK023). 이 차례를 연 사람은 언제나 닫을 수 있다. 관리자는 '관리자로' 닫으면 일찍 닫을 수 있고, 그
-- 일은 관리 기록에 남는다. 결론 글 id를 돌려준다.
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

GRANT EXECUTE ON FUNCTION "public"."close_discussion"(bigint, text, boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."close_discussion"(bigint, text, boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."close_discussion"(bigint, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."close_discussion"(bigint, text, boolean) TO "postgres";

REVOKE ALL ON FUNCTION "public"."close_discussion"(bigint, text, boolean) FROM PUBLIC, "anon";

-- 닫힌 토론을 다시 연다. 10자 이상의 글을 함께 쓴다. 다시 연 사람이 이 차례를 연 사람이 된다.
-- 글 id를 돌려준다.
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

GRANT EXECUTE ON FUNCTION "public"."reopen_discussion"(bigint, text, boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."reopen_discussion"(bigint, text, boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."reopen_discussion"(bigint, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."reopen_discussion"(bigint, text, boolean) TO "postgres";

REVOKE ALL ON FUNCTION "public"."reopen_discussion"(bigint, text, boolean) FROM PUBLIC, "anon";

-- 토론에 `p_after_post_id` 뒤의 답글이 남아 있는가. 거두지 않은 글만 센다. 첫 글과 제목 바꾸기 글은
-- 답글이 아니다. 제목 바꾸기 글은 누구도 거둘 수 없어서 세면 영영 거둘 수 없다. 화면의
-- `countsAsReply`와 같은 판단이다.
CREATE OR REPLACE FUNCTION private.discussion_has_replies (
  p_discussion_id bigint,
  p_after_post_id bigint
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select exists (
    select 1 from private.discussion_posts as reply
    where reply.discussion_id = p_discussion_id and reply.id > p_after_post_id
      and reply.kind not in ('open', 'rename') and reply.withdrawn_at is null
  );
$function$;

REVOKE ALL ON FUNCTION "private"."discussion_has_replies"(bigint, bigint) FROM PUBLIC;

-- 내 글을 거둔다. 내 글 뒤에 거두지 않은 글(제목 바꾸기 글 말고)이 없을 때만 된다(WK024). 첫 글은
-- 토론 거두기로, 닫기·다시 열기 글과 숨긴 글은 거둘 수 없다(WK024). 거둔 글은 "거둔 글"로만 보인다.
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
  -- 숨긴 글을 거두면 "거둔 글"로 보여 관리자가 숨김을 되돌릴 수 없다.
  if v_post.hidden_at is not null then
    raise exception 'hidden post' using errcode = 'WK024', detail = 'hidden';
  end if;
  if private.discussion_has_replies(v_post.discussion_id, v_post.id) then
    raise exception 'there are replies' using errcode = 'WK024', detail = 'replies';
  end if;

  update private.discussion_posts set withdrawn_at = now() where id = p_post_id;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."withdraw_discussion_post"(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."withdraw_discussion_post"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."withdraw_discussion_post"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."withdraw_discussion_post"(bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."withdraw_discussion_post"(bigint) FROM PUBLIC, "anon";

-- 내가 연 토론을 거둔다. 첫 글과 제목 바꾸기 글 말고 거두지 않은 글이 없을 때만 된다(WK024). 거둔 토론은 아무에게도
-- 보이지 않는다. 화면이 토론 목록으로 돌아가도록 문서 제목을 돌려준다.
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
  if private.discussion_has_replies(v_discussion.id, 0) then
    raise exception 'there are replies' using errcode = 'WK024', detail = 'replies';
  end if;

  update private.discussions set withdrawn_at = now() where id = v_discussion.id;
  return (select title from public.pages where id = v_discussion.page_id);
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."withdraw_discussion"(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."withdraw_discussion"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."withdraw_discussion"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."withdraw_discussion"(bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."withdraw_discussion"(bigint) FROM PUBLIC, "anon";

-- ── 관리자 ───────────────────────────────────────────────────────────────────

-- 글 하나를 숨기거나 되살린다(관리자 전용). 늘 '관리자' 이름이고 사유와 함께 관리 기록에 남는다.
-- 관리 기록에는 문서 제목과 토론 번호(`discussion_id`)만 남긴다. 토론 제목과 글은 숨기거나 지울 대상일 수
-- 있어서 적지 않는다. 숨기면 트리거가 그 글의 신고를 닫는다.
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

GRANT EXECUTE ON FUNCTION "public"."set_discussion_post_hidden"(bigint, boolean, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_discussion_post_hidden"(bigint, boolean, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_discussion_post_hidden"(bigint, boolean, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_discussion_post_hidden"(bigint, boolean, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."set_discussion_post_hidden"(bigint, boolean, text) FROM PUBLIC, "anon";

-- 토론을 지우거나 되살린다(관리자 전용). 지운 토론은 관리자에게만 보인다. 거둔 토론은 대상이 아니다.
-- 지우면 트리거가 그 토론의 글의 신고를 닫는다.
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

GRANT EXECUTE ON FUNCTION "public"."set_discussion_deleted"(bigint, boolean, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_discussion_deleted"(bigint, boolean, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_discussion_deleted"(bigint, boolean, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_discussion_deleted"(bigint, boolean, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."set_discussion_deleted"(bigint, boolean, text) FROM PUBLIC, "anon";

-- 관리자가 토론 제목을 바꾼다. 닫힌 토론도 된다. 관리 기록 대신 토론에 '관리자' 이름의 `rename` 글을
-- 남긴다. 글에는 앞 제목과 새 제목이 들어 있다.
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

GRANT EXECUTE ON FUNCTION "public"."rename_discussion"(bigint, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."rename_discussion"(bigint, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."rename_discussion"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."rename_discussion"(bigint, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."rename_discussion"(bigint, text) FROM PUBLIC, "anon";

-- ── 읽기 ─────────────────────────────────────────────────────────────────────

-- 문서의 토론 목록. 최근 활동순이다. 열린·닫힌 거르기는 화면이 한다. 지운 토론은 관리자에게만
-- 나온다(`deleted`). `post_count`는 거두지 않은 글 수(첫 글 포함)다.
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

GRANT EXECUTE ON FUNCTION "public"."list_page_discussions"(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_page_discussions"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_page_discussions"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_page_discussions"(bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_page_discussions"(bigint) FROM PUBLIC, "anon";

-- 위키 전체의 최근 토론 100개, 최근 활동순. 최근 토론 화면이 쓴다. 지운 토론은 관리자에게도 나오지 않는다.
-- 열 뜻은 `list_page_discussions`와 같다.
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

GRANT EXECUTE ON FUNCTION "public"."list_recent_discussions"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_recent_discussions"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_recent_discussions"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_recent_discussions"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_recent_discussions"() FROM PUBLIC, "anon";

-- 문서의 열린 토론 수. 문서의 토론 단추가 쓴다. 지운 토론은 관리자에게도 세지 않는다.
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

GRANT EXECUTE ON FUNCTION "public"."count_open_discussions"(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."count_open_discussions"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."count_open_discussions"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_open_discussions"(bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."count_open_discussions"(bigint) FROM PUBLIC, "anon";

-- 판마다 붙은 토론 수. 기록 화면이 쓴다. 지운 토론은 세지 않는다.
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

GRANT EXECUTE ON FUNCTION "public"."revision_discussion_counts"(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."revision_discussion_counts"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."revision_discussion_counts"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."revision_discussion_counts"(bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."revision_discussion_counts"(bigint) FROM PUBLIC, "anon";

-- 토론의 변경 표(`private.discussion_version`). 볼 수 없는 토론이면 NULL이다. 토론 화면이 5초마다 부르므로
-- 가볍게 둔다.
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

GRANT EXECUTE ON FUNCTION "public"."get_discussion_version"(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."get_discussion_version"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_discussion_version"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_discussion_version"(bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_discussion_version"(bigint) FROM PUBLIC, "anon";

-- 토론 하나와 글 전체. 볼 수 없는 토론은 없는 토론과 같다(WK006). `version`은 `get_discussion_version`과
-- 같은 값이다.
--
-- 글의 `state`는 `visible`·`withdrawn`(작성자가 거둠)·`hidden`(관리자가 숨김)이다. 보이지 않는 글의
-- 본문은 관리자에게만 준다. `mine`은 내가 쓴 글이다(거두기 단추). 토론의 `close_after`는 일반 회원이
-- 닫을 수 있게 되는 시각이고, `opened_by_me`면 그 전에도 닫을 수 있다.
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

GRANT EXECUTE ON FUNCTION "public"."get_discussion"(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."get_discussion"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_discussion"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_discussion"(bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_discussion"(bigint) FROM PUBLIC, "anon";

-- ── 신고 ─────────────────────────────────────────────────────────────────────

-- 토론 글 신고의 대상. 테이블은 `70-reports.sql`에 있다.
ALTER TABLE "private"."reports"
  ADD CONSTRAINT "reports_post_id_fkey" FOREIGN KEY (post_id) REFERENCES private.discussion_posts(id) ON DELETE CASCADE;

-- 토론 글이 회원에게 보이지 않게 되면 그 글의 신고를 닫는다. 판의 트리거(`70-reports.sql`)와 같다.
-- 글을 숨기거나 거두면 그 글의 신고를, 토론을 지우거나 거두면 그 토론의 글의 신고를 닫는다.
CREATE OR REPLACE FUNCTION private.close_hidden_post_reports()
  RETURNS trigger
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

REVOKE ALL ON FUNCTION "private"."close_hidden_post_reports"() FROM PUBLIC;

CREATE TRIGGER close_reports_on_hide AFTER UPDATE OF hidden_at ON private.discussion_posts FOR EACH ROW WHEN (((old.hidden_at IS NULL) AND (new.hidden_at IS NOT NULL))) EXECUTE FUNCTION private.close_hidden_post_reports();

CREATE TRIGGER close_reports_on_withdraw AFTER UPDATE OF withdrawn_at ON private.discussion_posts FOR EACH ROW WHEN (((old.withdrawn_at IS NULL) AND (new.withdrawn_at IS NOT NULL))) EXECUTE FUNCTION private.close_hidden_post_reports();

CREATE OR REPLACE FUNCTION private.close_hidden_discussion_reports()
  RETURNS trigger
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

REVOKE ALL ON FUNCTION "private"."close_hidden_discussion_reports"() FROM PUBLIC;

CREATE TRIGGER close_reports_on_delete AFTER UPDATE OF deleted_at ON private.discussions FOR EACH ROW WHEN (((old.deleted_at IS NULL) AND (new.deleted_at IS NOT NULL))) EXECUTE FUNCTION private.close_hidden_discussion_reports();

CREATE TRIGGER close_reports_on_withdraw AFTER UPDATE OF withdrawn_at ON private.discussions FOR EACH ROW WHEN (((old.withdrawn_at IS NULL) AND (new.withdrawn_at IS NOT NULL))) EXECUTE FUNCTION private.close_hidden_discussion_reports();

-- 문서를 삭제하면 그 문서의 토론 글의 신고를 닫는다. 삭제된 문서의 토론은 회원에게 보이지 않는다.
CREATE OR REPLACE FUNCTION private.close_deleted_page_post_reports()
  RETURNS trigger
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

REVOKE ALL ON FUNCTION "private"."close_deleted_page_post_reports"() FROM PUBLIC;

CREATE TRIGGER close_post_reports_on_delete AFTER UPDATE OF deleted_at ON public.pages FOR EACH ROW WHEN (((old.deleted_at IS NULL) AND (new.deleted_at IS NOT NULL))) EXECUTE FUNCTION private.close_deleted_page_post_reports();

-- 토론 글 하나를 신고한다. 토론을 신고하려면 첫 글을 신고한다. 규칙은 판 신고(`report_revision`)와
-- 같다. 내 글, 회원에게 보이지 않는 토론(관리자만 보는 지운 토론 포함)의 글, 숨기거나 거둔 글,
-- 닫기·다시 열기·제목 바꾸기 글은 없는 글과 같은 오류다. 보이지 않는 글의 신고는 트리거가 닫으므로
-- 받지 않는다. 닫기·다시 열기 글은 토론의 상태를, 제목 바꾸기 글은 관리 기록을 겸한다.
CREATE OR REPLACE FUNCTION public.report_discussion_post (
  p_post_id  bigint,
  p_category text,
  p_note     text DEFAULT ''::text
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

GRANT EXECUTE ON FUNCTION "public"."report_discussion_post"(bigint, text, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."report_discussion_post"(bigint, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."report_discussion_post"(bigint, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."report_discussion_post"(bigint, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."report_discussion_post"(bigint, text, text) FROM PUBLIC, "anon";

-- 처리되지 않은 토론 글 신고를 글별로 묶는다(관리자 전용). 신고자는 돌려주지 않는다. 오래된 신고부터.
-- 열린 신고의 글은 회원에게 보인다(트리거). 숨기거나 거둔 글, 지우거나 거둔 토론의 글은 없다.
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

GRANT EXECUTE ON FUNCTION "public"."list_open_post_reports"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_open_post_reports"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_open_post_reports"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_open_post_reports"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_open_post_reports"() FROM PUBLIC, "anon";

-- 토론 글 하나에 걸린 처리되지 않은 신고를 모두 닫는다(관리자 전용). `resolve_reports`와 같다.
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

GRANT EXECUTE ON FUNCTION "public"."resolve_post_reports"(bigint, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."resolve_post_reports"(bigint, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_post_reports"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_post_reports"(bigint, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."resolve_post_reports"(bigint, text) FROM PUBLIC, "anon";
