-- 선언적 스키마 정본. 이 파일을 먼저 고치고 `pnpm db:diff <이름>`으로 migration 초안을 만든 뒤 검토한다.
--
-- 문서, 판, 가명, 문서 간 참조(page_refs), 문서 본문(doc) 도우미, 읽기·저장·이동·삭제 RPC.

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION private.check_body (
  p_body jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  v_profile jsonb;
begin
  -- 노드 한 겹이 JSON 두 겹(`content` 배열과 노드)이다. 편집기에서 만드는 문서는 이보다 훨씬 얕다.
  if jsonb_path_exists(p_body, 'strict $.**{200}') then
    raise exception 'invalid body' using errcode = 'WK012';
  end if;

  if jsonb_typeof(p_body) is distinct from 'object'
     or p_body ->> 'type' is distinct from 'doc'
     or jsonb_typeof(p_body -> 'content') is distinct from 'array'
     or (p_body ? 'attrs' and jsonb_typeof(p_body -> 'attrs') <> 'object')
     or (coalesce(p_body -> 'attrs', '{}'::jsonb) ? 'categories'
         and jsonb_typeof(p_body -> 'attrs' -> 'categories') <> 'array')
     or (coalesce(p_body -> 'attrs', '{}'::jsonb) ? 'redirect'
         and jsonb_typeof(p_body -> 'attrs' -> 'redirect') <> 'string') then
    raise exception 'invalid body' using errcode = 'WK012';
  end if;

  if jsonb_path_exists(
    p_body,
    'strict $.** ? (@.type == "link").attrs.href ? (!(@ like_regex "^(https?:|mailto:)" flag "i"))'
  ) then
    raise exception 'unsafe link' using errcode = 'WK012', detail = 'link';
  end if;

  -- 제목 단계는 편집기가 쓰는 2~4만. 화면은 범위 밖 값을 맞춰 그리지만 저장부터 막는다.
  if jsonb_path_exists(
    p_body,
    'strict $.** ? (@.type == "heading").attrs.level ? (!(@ == 2 || @ == 3 || @ == 4))'
  ) then
    raise exception 'invalid body' using errcode = 'WK012';
  end if;

  -- 이미지·영상 캡션은 캡션 노드(`content`)에 둔다. 배포 전에 연 탭의 편집기는 `attrs.caption`(글자)을
  -- 보낸다. 받으면 캡션이 오류 없이 사라지므로 저장을 막는다. 새로 고치면 새 편집기로 저장할 수 있다.
  if jsonb_path_exists(
    p_body,
    'strict $.** ? (@.type == "image" || @.type == "youtube").attrs.caption'
  ) then
    raise exception 'outdated body' using errcode = 'WK012', detail = 'caption';
  end if;

  -- 프로필(`features/markup/model/profile.ts`). 본문과 같은 블록 노드 목록이다. 링크 주소와 제목 단계는
  -- 위의 `$.**` 검사가 프로필 안까지 본다.
  v_profile := p_body -> 'attrs' -> 'profile';
  if v_profile is not null and (
    jsonb_typeof(v_profile) <> 'array'
    or exists (
      select
      from jsonb_array_elements(v_profile) as block (value)
      where jsonb_typeof(block.value) is distinct from 'object'
         or jsonb_typeof(block.value -> 'type') is distinct from 'string'
    )
  ) then
    raise exception 'invalid body' using errcode = 'WK012', detail = 'profile';
  end if;
end;
$function$;

GRANT EXECUTE ON FUNCTION "private"."check_body"(jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."check_body"(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.check_write_limits (
  p_member_id bigint,
  p_body      jsonb,
  p_summary   text
)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if octet_length(p_body::text) > 1000000 then
    raise exception 'body too long' using errcode = 'WK005', detail = 'body';
  end if;
  if char_length(coalesce(p_summary, '')) > 200 then
    raise exception 'summary too long' using errcode = 'WK005', detail = 'summary';
  end if;
  if not private.is_admin() and (
    select count(*) from private.revision_authors as written
    where written.member_id = p_member_id
      and written.created_at > now() - interval '10 minutes'
  ) >= 60 then
    raise exception 'too many edits' using errcode = 'WK005', detail = 'rate';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."check_write_limits"(bigint, jsonb, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.doc_heading (
  p_level integer,
  p_text  text
)
  RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select jsonb_build_object(
    'type', 'heading', 'attrs', jsonb_build_object('level', p_level),
    'content', jsonb_build_array(private.doc_text_node(p_text))
  );
$function$;

REVOKE ALL ON FUNCTION "private"."doc_heading"(integer, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.doc_is_empty (
  p_body jsonb
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select not jsonb_path_exists(
      p_body,
      'strict $.content[*] ? (@.type != "paragraph" || exists(@.content[*]))'
    )
    and coalesce(p_body -> 'attrs' ->> 'redirect', '') = ''
    and coalesce(jsonb_array_length(p_body -> 'attrs' -> 'categories'), 0) = 0
    and not jsonb_path_exists(
      p_body,
      -- lax: 속성이나 프로필이 없으면 빈 결과다(strict는 없는 키에서 오류를 낸다).
      'lax $.attrs.profile[*] ? (@.type != "paragraph" || exists(@.content[*]))'
    );
$function$;

GRANT EXECUTE ON FUNCTION "private"."doc_is_empty"(jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."doc_is_empty"(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.doc_link (
  p_target text,
  p_label  text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select jsonb_build_object(
    'type', 'text', 'text', coalesce(p_label, p_target),
    'marks', jsonb_build_array(jsonb_build_object(
      'type', 'wikiLink', 'attrs', jsonb_build_object('target', p_target, 'section', '')
    ))
  );
$function$;

REVOKE ALL ON FUNCTION "private"."doc_link"(text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.doc_list (
  VARIADIC p_items jsonb[]
)
  RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select jsonb_build_object('type', 'bulletList', 'content', (
    select jsonb_agg(jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(item)))
    from unnest(p_items) as item
  ));
$function$;

REVOKE ALL ON FUNCTION "private"."doc_list"(jsonb[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.doc_of (
  VARIADIC p_blocks jsonb[]
)
  RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select jsonb_build_object('type', 'doc', 'content', to_jsonb(p_blocks));
$function$;

REVOKE ALL ON FUNCTION "private"."doc_of"(jsonb[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.doc_para (
  VARIADIC p_inline jsonb[]
)
  RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select jsonb_build_object('type', 'paragraph', 'content', to_jsonb(p_inline));
$function$;

REVOKE ALL ON FUNCTION "private"."doc_para"(jsonb[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.doc_text_node (
  p_text   text,
  VARIADIC p_marks text[] DEFAULT '{}'::text[]
)
  RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select case when cardinality(p_marks) = 0
    then jsonb_build_object('type', 'text', 'text', p_text)
    else jsonb_build_object(
      'type', 'text', 'text', p_text,
      'marks', (select jsonb_agg(jsonb_build_object('type', mark)) from unnest(p_marks) as mark)
    )
  end;
$function$;

REVOKE ALL ON FUNCTION "private"."doc_text_node"(text, text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.doc_text (
  p_body jsonb
)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  v_type text := p_body ->> 'type';
  v_separator text;
  v_out text;
  v_children text;
begin
  if jsonb_typeof(p_body) is distinct from 'object' then
    return '';
  end if;
  case v_type
    when 'text' then return coalesce(p_body ->> 'text', '');
    when 'hardBreak' then return E'\n';
    else null;
  end case;

  -- 이미지·영상은 내용(캡션 노드)의 글자만 보인다. 대체 텍스트는 보이지 않는다.
  v_separator := case when v_type in ('paragraph', 'heading', 'codeBlock', 'footnote', 'caption') then '' else E'\n' end;
  -- 접기는 제목도 보이는 글자다.
  v_out := case when v_type = 'fold' then nullif(p_body -> 'attrs' ->> 'title', '') end;
  -- 자식 글자는 한 번에 잇는다. 하나씩 덧붙이면 글이 길수록 앞부분을 거듭 복사한다.
  -- 문서 안에 들어간 doc 노드는 화면에 그리지 않으므로 그 안의 글자도 읽지 않는다.
  if jsonb_typeof(p_body -> 'content') = 'array' then
    select string_agg(private.doc_text(child.value), v_separator order by child.position)
    into v_children
    from jsonb_array_elements(p_body -> 'content') with ordinality as child (value, position)
    where child.value ->> 'type' is distinct from 'doc';
    v_out := case when v_out is null then v_children
                  when v_children is null then v_out
                  else v_out || v_separator || v_children end;
  end if;
  -- 각주 내용은 앞 글자와 띄어 둔다(검색에서 앞 낱말과 붙지 않게).
  if v_type = 'footnote' then
    return ' ' || coalesce(v_out, '');
  end if;
  -- 캡션 앞뒤의 빈칸은 화면에서 보이지 않는다.
  if v_type = 'caption' then
    return btrim(coalesce(v_out, ''));
  end if;
  -- 프로필도 보이는 글자다(검색, 문서 길이). 문서 보기처럼 본문 앞에 둔다.
  -- 이 줄이 생기기 전의 판에는 프로필이 없으므로 저장된 `body_text`는 그대로 맞다.
  if v_type = 'doc' and jsonb_typeof(p_body -> 'attrs' -> 'profile') = 'array' then
    -- 블록 사이는 본문과 같이 줄바꿈이다. 문서 노드를 새로 만들지 않는다(`jsonb_build_object`는 STABLE).
    select string_agg(private.doc_text(block.value), E'\n' order by block.position)
    into v_children
    from jsonb_array_elements(p_body -> 'attrs' -> 'profile') with ordinality as block (value, position)
    where block.value ->> 'type' is distinct from 'doc';
    v_out := case when coalesce(v_children, '') = '' then v_out
                  when coalesce(v_out, '') = '' then v_children
                  else v_children || E'\n' || v_out end;
  end if;
  return coalesce(v_out, '');
end;
$function$;

GRANT EXECUTE ON FUNCTION "private"."doc_text"(jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."doc_text"(jsonb) FROM PUBLIC;

-- ── 본문 다루기 ──────────────────────────────────────────────────────────────
-- 빈 문서. 본문이 없는 판(삭제된 문서 등)을 읽을 때 쓴다.
CREATE OR REPLACE FUNCTION private.empty_doc()
  RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb;
$function$;

GRANT EXECUTE ON FUNCTION "private"."empty_doc"() TO "authenticated";

REVOKE ALL ON FUNCTION "private"."empty_doc"() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.extract_refs (
  p_body jsonb
)
  RETURNS TABLE (
    kind   text,
    target text
  )
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  v_body jsonb := coalesce(p_body, '{}'::jsonb);
  v_raw text;
  v_title text;
begin
  if jsonb_typeof(v_body -> 'attrs' -> 'redirect') = 'string' then
    v_title := private.normalize_title(v_body -> 'attrs' ->> 'redirect');
    -- 넘겨주기는 대상으로 가는 링크이기도 하다(역링크에 넘겨주기 문서가 보인다).
    if private.is_valid_title(v_title) then
      kind := 'redirect';
      target := v_title;
      return next;
      kind := 'link';
      return next;
    end if;
  end if;

  if jsonb_typeof(v_body -> 'attrs' -> 'categories') = 'array' then
    for v_raw in
      select item #>> '{}'
      from jsonb_array_elements(v_body -> 'attrs' -> 'categories') as item
      where jsonb_typeof(item) = 'string'
    loop
      v_title := private.normalize_title(v_raw);
      if v_title is not null and v_title !~ '^분류:' then
        v_title := private.normalize_title('분류:' || v_title);
      end if;
      if private.is_valid_title(v_title) then
        kind := 'category';
        target := v_title;
        return next;
      end if;
    end loop;
  end if;

  for v_raw in
    select found.value #>> '{}'
    from jsonb_path_query(v_body, 'strict $.** ? (@.type == "wikiLink").attrs.target')
      as found (value)
    where jsonb_typeof(found.value) = 'string'
  loop
    v_title := private.normalize_title(v_raw);
    if private.is_valid_title(v_title) then
      kind := 'link';
      target := v_title;
      return next;
    end if;
  end loop;

  for v_raw in
    select found.value #>> '{}'
    from jsonb_path_query(v_body, 'strict $.** ? (@.type == "template").attrs.name')
      as found (value)
    where jsonb_typeof(found.value) = 'string'
  loop
    v_title := private.normalize_title(v_raw);
    if v_title is not null and v_title !~ '^틀:' then
      v_title := private.normalize_title('틀:' || v_title);
    end if;
    if private.is_valid_title(v_title) then
      kind := 'template';
      target := v_title;
      return next;
    end if;
  end loop;

  for v_raw in
    select found.value #>> '{}'
    from jsonb_path_query(v_body, 'strict $.** ? (@.type == "image").attrs.id')
      as found (value)
    where jsonb_typeof(found.value) = 'string'
  loop
    if v_raw ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      kind := 'image';
      target := v_raw;
      return next;
    end if;
  end loop;
end;
$function$;

GRANT EXECUTE ON FUNCTION "private"."extract_refs"(jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."extract_refs"(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.is_valid_title (
  p_title text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select p_title is not null
    and char_length(p_title) between 1 and 100
    and p_title !~ '[][{}|#<>\\[:cntrl:]]'
    and p_title !~ '^[/:]'
    and p_title !~ '/$'
    and p_title !~ '//'
    -- 주소 경로에서 `.`과 `..`은 상위 경로로 해석된다.
    and p_title !~ '(^|/)\.{1,2}(/|$)'
    -- 이름공간만 있고 이름이 없는 제목.
    and p_title !~ '^(틀|분류|위키):$';
$function$;

GRANT EXECUTE ON FUNCTION "private"."is_valid_title"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."is_valid_title"(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.normalize_title (
  p_title text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select nullif(
    regexp_replace(
      regexp_replace(
        btrim(regexp_replace(normalize(coalesce(p_title, ''), NFC), '[[:space:]_]+', ' ', 'g')),
        ' */ *', '/', 'g'
      ),
      '^(틀|분류|위키) *: *', '\1:'
    ),
    ''
  );
$function$;

GRANT EXECUTE ON FUNCTION "private"."normalize_title"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."normalize_title"(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.pseudonym_for (
  p_page_id   bigint,
  p_member_id bigint
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_pseudonym text;
begin
  select assigned.pseudonym into v_pseudonym
  from private.page_pseudonyms as assigned
  where assigned.page_id = p_page_id and assigned.member_id = p_member_id;

  if v_pseudonym is not null then
    return v_pseudonym;
  end if;

  -- 16진수 6자리(약 1,600만 가지). 같은 문서 안에서 겹치면 다시 뽑는다.
  for attempt in 1..20 loop
    v_pseudonym := '익명#' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into private.page_pseudonyms (page_id, member_id, pseudonym)
      values (p_page_id, p_member_id, v_pseudonym);
      return v_pseudonym;
    exception when unique_violation then
      -- 같은 사람이 동시에 두 번 저장했다면 먼저 들어간 가명을 쓴다.
      select assigned.pseudonym into v_pseudonym
      from private.page_pseudonyms as assigned
      where assigned.page_id = p_page_id and assigned.member_id = p_member_id;
      if v_pseudonym is not null then
        return v_pseudonym;
      end if;
    end;
  end loop;

  raise exception 'could not assign a pseudonym';
end;
$function$;

REVOKE ALL ON FUNCTION "private"."pseudonym_for"(bigint, bigint) FROM PUBLIC;

-- ── 쓰기 내부 함수 ───────────────────────────────────────────────────────────
-- 호출자 검증: 회원 확인과 차단. 통과하면 member id를 돌려준다.
CREATE OR REPLACE FUNCTION private.require_editor()
  RETURNS bigint
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
  if private.member_is_banned(v_member_id) then
    raise exception 'banned' using errcode = 'WK002';
  end if;
  return v_member_id;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."require_editor"() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.title_key (
  p_title text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select lower(private.normalize_title(p_title));
$function$;

GRANT EXECUTE ON FUNCTION "private"."title_key"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "private"."title_key"(text) FROM PUBLIC;

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
  v_parent_size integer;
  v_revision_id bigint;
  v_size integer := octet_length(private.doc_text(p_body));
begin
  select page.current_revision_id, revision.byte_size
  into v_parent_id, v_parent_size
  from public.pages as page
  left join public.revisions as revision on revision.id = page.current_revision_id
  where page.id = p_page_id;

  insert into public.revisions (
    page_id, parent_revision_id, body, summary, author_pseudonym, kind, byte_size, byte_delta
  )
  values (
    p_page_id,
    v_parent_id,
    p_body,
    coalesce(btrim(p_summary), ''),
    case when p_as_admin then '관리자' else private.pseudonym_for(p_page_id, p_member_id) end,
    p_kind,
    v_size,
    v_size - coalesce(v_parent_size, 0)
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

REVOKE ALL ON FUNCTION "private"."write_revision"(bigint, bigint, jsonb, text, text, boolean) FROM PUBLIC;

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

GRANT EXECUTE ON FUNCTION "public"."get_page_view"(text, boolean, bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."get_page_view"(text, boolean, bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_page_view"(text, boolean, bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_page_view"(text, boolean, bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_page_view"(text, boolean, bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.move_page (
  p_title          text,
  p_new_title      text,
  p_leave_redirect boolean DEFAULT true
)
  RETURNS TABLE (
    page_id     bigint,
    revision_id bigint,
    title       text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_new_title text := private.normalize_title(p_new_title);
  v_page public.pages;
  v_taken public.pages;
  v_old_title text;
  v_old_key text;
  v_new_key text := private.title_key(v_new_title);
  -- 3·4에서 넘겨줄 곳. 일반 문서면 새 이름, 넘겨주기 문서면 그 대상.
  v_destination text;
  v_body jsonb;
  v_alias record;
  v_redirect_page_id bigint;
begin
  if not private.is_valid_title(v_new_title) then
    raise exception 'invalid title' using errcode = 'WK004';
  end if;

  select * into v_page from public.pages as page
  where page.title_key = private.title_key(p_title)
  for update;
  if v_page.id is null then
    raise exception 'page not found' using errcode = 'WK006';
  end if;
  perform private.check_page_writable(v_page);
  v_old_title := v_page.title;
  v_old_key := v_page.title_key;

  if v_new_title = v_old_title then
    raise exception 'nothing to save' using errcode = 'WK007';
  end if;
  if v_page.redirect_key = v_new_key then
    raise exception 'redirect to itself' using errcode = 'WK015', detail = 'self';
  end if;
  v_destination := coalesce(v_page.redirect_target, v_new_title);

  -- 1. 새 이름 자리. 대소문자나 공백만 바꾸는 이동은 같은 문서라 건너뛴다.
  if v_new_key <> v_old_key then
    select * into v_taken from public.pages as page
    where page.title_key = v_new_key
    for update;
    if v_taken.id is not null then
      if v_taken.redirect_key is distinct from v_old_key
         or exists (
           select 1 from public.revisions as revision
           where revision.page_id = v_taken.id
             and coalesce(revision.body -> 'attrs' ->> 'redirect', '') = ''
         )
         or ((v_taken.protection = 'admin' or v_taken.deleted_at is not null)
             and not private.is_admin()) then
        raise exception 'title already exists' using errcode = 'WK009';
      end if;
      -- 판·가명·참조가 함께 지워진다(on delete cascade).
      delete from public.pages where id = v_taken.id;
    end if;
  end if;

  select revision.body into v_body
  from public.revisions as revision where revision.id = v_page.current_revision_id;
  v_body := coalesce(v_body, private.empty_doc());
  perform private.check_write_limits(v_member_id, v_body, '');

  -- 2. 이름 바꾸기. page id가 그대로라 판 기록과 가명이 유지된다. 하위 문서는 함께 옮기지 않는다.
  update public.pages set title = v_new_title where id = v_page.id;

  page_id := v_page.id;
  title := v_new_title;
  revision_id := private.write_revision(
    v_page.id, v_member_id, v_body,
    format('%s → %s 이동', v_old_title, v_new_title), 'move'
  );

  -- 3. 옛 이름으로 오던 넘겨주기를 넘겨줄 곳으로. 대소문자만 바꿨다면 지금도 이 문서로 온다.
  --    삭제된 넘겨주기는 두고, 복구하면 끊긴 넘겨주기 목록에서 찾아 고친다. 넘겨줄 곳 자신은
  --    (X → 이 넘겨주기 → X 고리) 자기 자신을 가리키게 되므로 건드리지 않는다.
  if v_new_key <> v_old_key then
    for v_alias in
      select alias.id, revision.body
      from public.pages as alias
      join public.revisions as revision on revision.id = alias.current_revision_id
      where alias.redirect_key = v_old_key
        and alias.deleted_at is null
        and alias.id <> v_page.id
        and alias.title_key <> private.title_key(v_destination)
      order by alias.id
      for update of alias
    loop
      perform private.write_revision(
        v_alias.id, v_member_id,
        jsonb_set(v_alias.body, '{attrs,redirect}', to_jsonb(v_destination)),
        format('%s 이동에 따라 대상을 %s(으)로 바꿈', v_old_title, v_destination), 'edit'
      );
    end loop;
  end if;

  -- 4. 옛 이름에 넘겨주기 남기기.
  if p_leave_redirect and v_new_key <> v_old_key then
    insert into public.pages (title) values (v_old_title) returning id into v_redirect_page_id;
    perform private.write_revision(
      v_redirect_page_id, v_member_id,
      private.redirect_doc(v_destination),
      format('%s 이동으로 생긴 넘겨주기', v_new_title), 'edit'
    );
  end if;

  return next;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."move_page"(text, text, boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."move_page"(text, text, boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."move_page"(text, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."move_page"(text, text, boolean) TO "postgres";

REVOKE ALL ON FUNCTION "public"."move_page"(text, text, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.my_pseudonym (
  p_page_id bigint
)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select assigned.pseudonym
  from private.page_pseudonyms as assigned
  where assigned.page_id = p_page_id
    and assigned.member_id = private.current_member_id();
$function$;

GRANT EXECUTE ON FUNCTION "public"."my_pseudonym"(bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."my_pseudonym"(bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."my_pseudonym"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."my_pseudonym"(bigint) TO "postgres";

REVOKE ALL ON FUNCTION "public"."my_pseudonym"(bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.page_backlinks (
  p_title_key text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce(jsonb_agg(
    jsonb_build_object('title', linking.title, 'is_redirect', linking.is_redirect)
    order by linking.is_redirect desc, linking.title
  ), '[]'::jsonb)
  from (
    select page.title, page.redirect_key is not distinct from p_title_key as is_redirect
    from public.pages as page
    where page.deleted_at is null
      and page.title_key <> p_title_key
      and (
        page.redirect_key = p_title_key
        or exists (
          select 1 from public.page_refs as ref
          where ref.from_page_id = page.id and ref.kind = 'link' and ref.target_key = p_title_key
        )
      )
    order by page.title
    limit 200
  ) as linking;
$function$;

GRANT EXECUTE ON FUNCTION "public"."page_backlinks"(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."page_backlinks"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."page_backlinks"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."page_backlinks"(text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."page_backlinks"(text) FROM PUBLIC, "anon";

-- 아무 문서로. 넘겨주기·틀·분류·운영 문서는 뺀다.
CREATE OR REPLACE FUNCTION public.random_page()
  RETURNS text
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  select page.title
  from public.pages as page
  where page.namespace = 'main' and page.redirect_key is null and page.deleted_at is null
  order by random()
  limit 1;
$function$;

GRANT EXECUTE ON FUNCTION "public"."random_page"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."random_page"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."random_page"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."random_page"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."random_page"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.resolve_body (
  p_body jsonb
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  with recursive body_refs as (
    select ref.kind, lower(ref.target) as target_key
    from private.extract_refs(p_body) as ref
  ),
  templates as (
    select page.id, page.title, page.title_key, 1 as depth
    from body_refs
    join public.pages as page on page.title_key = body_refs.target_key
    where body_refs.kind = 'template'
    union
    select page.id, page.title, page.title_key, templates.depth + 1
    from templates
    join public.page_refs as ref on ref.from_page_id = templates.id and ref.kind = 'template'
    join public.pages as page on page.title_key = ref.target_key
    where templates.depth < 3
  ),
  template_ids as (
    select distinct templates.id, templates.title, templates.title_key from templates
  ),
  all_refs as (
    select body_refs.kind, body_refs.target_key from body_refs
    union
    select ref.kind, ref.target_key
    from template_ids
    join public.page_refs as ref on ref.from_page_id = template_ids.id
  )
  select jsonb_build_object(
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object('title', template_ids.title, 'body', revision.body))
      from template_ids
      join public.pages as page on page.id = template_ids.id
      join public.revisions as revision on revision.id = page.current_revision_id
    ), '[]'::jsonb),
    'existing', coalesce((
      select jsonb_agg(distinct page.title_key)
      from all_refs
      join public.pages as page on page.title_key = all_refs.target_key
      where all_refs.kind in ('link', 'category')
    ), '[]'::jsonb)
  );
$function$;

GRANT EXECUTE ON FUNCTION "public"."resolve_body"(jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."resolve_body"(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_body"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_body"(jsonb) TO "postgres";

REVOKE ALL ON FUNCTION "public"."resolve_body"(jsonb) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.revert_page (
  p_revision_id bigint,
  p_summary     text   DEFAULT ''::text
)
  RETURNS TABLE (
    page_id     bigint,
    revision_id bigint,
    title       text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_target public.revisions;
  v_page public.pages;
  v_current_body jsonb;
  v_body jsonb;
  v_summary text;
begin
  select * into v_target from public.revisions as revision where revision.id = p_revision_id;
  -- 숨긴 판은 관리자만 되살릴 수 있다. 없는 판과 같은 오류로 답해 존재를 알리지 않는다.
  if v_target.id is null or (v_target.hidden_at is not null and not private.is_admin()) then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;

  select * into v_page from public.pages as page where page.id = v_target.page_id for update;
  perform private.check_page_writable(v_page);
  -- 옛 넘겨주기 판이면 지금의 최종 문서로 바꿔 되살린다(`save_revision`과 같다). 본문 규칙
  -- (`check_redirect_body`)은 보지 않는다. 규칙 이전에 저장된 판도 되돌릴 수 있게 한다.
  v_body := private.settle_redirect_body(v_page.title, v_target.body);

  select revision.body into v_current_body
  from public.revisions as revision where revision.id = v_page.current_revision_id;
  if v_current_body = v_body then
    raise exception 'nothing to save' using errcode = 'WK007';
  end if;

  v_summary := format('r%s 판으로 되돌림', p_revision_id)
    || case when btrim(coalesce(p_summary, '')) <> '' then ': ' || btrim(p_summary) else '' end;
  perform private.check_write_limits(v_member_id, v_body, v_summary);

  page_id := v_page.id;
  title := v_page.title;
  revision_id := private.write_revision(v_page.id, v_member_id, v_body, v_summary, 'revert');
  return next;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."revert_page"(bigint, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."revert_page"(bigint, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."revert_page"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."revert_page"(bigint, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."revert_page"(bigint, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.save_revision (
  p_title            text,
  p_base_revision_id bigint,
  p_body             jsonb,
  p_summary          text   DEFAULT ''::text
)
  RETURNS TABLE (
    page_id     bigint,
    revision_id bigint,
    title       text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_title text := private.normalize_title(p_title);
  v_page public.pages;
  v_body jsonb := p_body;
  v_current_body jsonb;
begin
  if not private.is_valid_title(v_title) then
    raise exception 'invalid title' using errcode = 'WK004';
  end if;
  perform private.check_body(v_body);
  perform private.check_redirect_body(v_title, v_body);
  -- 넘겨주기 대상이 넘겨주기 문서이면 최종 문서로 바꿔 저장한다. 저장하는 이 넘겨주기가 넘겨주기
  -- 문서를 가리키지 않게 한다.
  v_body := private.settle_redirect_body(v_title, v_body);
  perform private.check_write_limits(v_member_id, v_body, p_summary);

  select * into v_page from public.pages as page
  where page.title_key = lower(v_title)
  for update;

  if v_page.id is null then
    if p_base_revision_id is not null then
      raise exception 'page not found' using errcode = 'WK006';
    end if;
    if private.doc_is_empty(v_body) then
      raise exception 'nothing to save' using errcode = 'WK007';
    end if;
    begin
      insert into public.pages (title) values (v_title) returning * into v_page;
    exception when unique_violation then
      -- 같은 제목을 다른 사람이 방금 만들었다.
      raise exception 'edit conflict' using errcode = 'WK001';
    end;
  else
    perform private.check_page_writable(v_page);
    if v_page.current_revision_id is distinct from p_base_revision_id then
      raise exception 'edit conflict' using errcode = 'WK001';
    end if;
    select revision.body into v_current_body
    from public.revisions as revision where revision.id = v_page.current_revision_id;
    if v_current_body = v_body then
      raise exception 'nothing to save' using errcode = 'WK007';
    end if;
  end if;

  page_id := v_page.id;
  title := v_page.title;
  revision_id := private.write_revision(v_page.id, v_member_id, v_body, p_summary, 'edit');
  return next;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."save_revision"(text, bigint, jsonb, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."save_revision"(text, bigint, jsonb, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."save_revision"(text, bigint, jsonb, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."save_revision"(text, bigint, jsonb, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."save_revision"(text, bigint, jsonb, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.search_pages (
  p_query text,
  p_limit integer DEFAULT 30
)
  RETURNS TABLE (
    title            text,
    matched_redirect text,
    snippet          text,
    rank             smallint
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  with query as (
    select lower(btrim(regexp_replace(coalesce(p_query, ''), '[[:space:]]+', ' ', 'g'))) as needle
  ),
  texts as (
    select page.id, revision.body_text as body
    from public.pages as page
    join public.revisions as revision on revision.id = page.current_revision_id
    where page.deleted_at is null and page.redirect_key is null
  ),
  hits as (
    -- 제목
    select page.id, page.title, null::text as matched_redirect,
      case
        when page.title_key = query.needle then 0
        when page.title_key like query.needle || '%' then 1
        else 2
      end as rank
    from public.pages as page, query
    where page.deleted_at is null and page.redirect_key is null
      and strpos(page.title_key, query.needle) > 0
    union all
    -- 넘겨주기 이름
    select target.id, target.title, page.title, 3
    from public.pages as page
    join public.pages as target on target.title_key = page.redirect_key, query
    where page.deleted_at is null and target.deleted_at is null
      and strpos(page.title_key, query.needle) > 0
    union all
    -- 본문
    select page.id, page.title, null, 4
    from texts
    join public.pages as page on page.id = texts.id, query
    where strpos(lower(texts.body), query.needle) > 0
  ),
  best as (
    select distinct on (hits.id) hits.id, hits.title, hits.matched_redirect, hits.rank
    from hits
    order by hits.id, hits.rank
  )
  select
    best.title,
    best.matched_redirect,
    -- 본문에서 맞은 곳 앞뒤.
    (
      select regexp_replace(
        substr(texts.body, greatest(strpos(lower(texts.body), query.needle) - 40, 1), 160),
        '[[:space:]]+', ' ', 'g'
      )
      from texts
      where texts.id = best.id and strpos(lower(texts.body), query.needle) > 0
    ),
    best.rank::smallint
  from best, query
  where char_length(query.needle) >= 1
  order by best.rank, best.title
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$function$;

GRANT EXECUTE ON FUNCTION "public"."search_pages"(text, integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."search_pages"(text, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."search_pages"(text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."search_pages"(text, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."search_pages"(text, integer) FROM PUBLIC, "anon";

-- ── 문서 ─────────────────────────────────────────────────────────────────────
CREATE TABLE "public"."pages" (
  "id"                  bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  -- 항상 `private.normalize_title()`을 거친 값이다.
  "title"               text                     NOT NULL,
  "title_key"           text                     GENERATED ALWAYS AS (lower(title)) STORED,
  "namespace"           text                     GENERATED ALWAYS AS (
CASE
    WHEN (title ~~ '틀:%'::text) THEN 'template'::text
    WHEN (title ~~ '분류:%'::text) THEN 'category'::text
    WHEN (title ~~ '위키:%'::text) THEN 'wiki'::text
    ELSE 'main'::text
END) STORED,
  -- 슬래시 앞부분. `귀가/정기 귀가`의 상위는 `귀가`다. 상위 문서가 실제로 없어도 된다.
  "parent_key"          text                     GENERATED ALWAYS AS (
CASE
    WHEN (title ~~ '%/%'::text) THEN lower(regexp_replace(title, '/[^/]*$'::text, ''::text))
    ELSE NULL::text
END) STORED,
  -- 넘겨주기 문서면 대상 제목. 본문(문서 속성 `redirect`)에서 서버가 뽑는다.
  "redirect_target"     text,
  "redirect_key"        text                     GENERATED ALWAYS AS (lower(redirect_target)) STORED,
  "current_revision_id" bigint,
  "protection"          text                     NOT NULL DEFAULT 'open'::text,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"          timestamp with time zone,
  CONSTRAINT "pages_pkey" PRIMARY KEY (id),
  CONSTRAINT "pages_protection" CHECK ((protection = ANY (ARRAY['open'::text, 'admin'::text]))),
  CONSTRAINT "pages_title_key_unique" UNIQUE (title_key)
);

ALTER TABLE "public"."pages"
  ENABLE ROW LEVEL SECURITY;

-- 곁의 최근 변경(`listRecentlyChangedPages`)은 문서를 현재 판 id 내림차순으로 앞 10개만 읽는다.
-- 모든 위키 화면이 30~60초마다 부르므로, 문서 표 전체를 정렬하지 않고 색인 앞부분만 읽게 한다.
CREATE INDEX pages_current_revision_idx ON public.pages USING btree (current_revision_id DESC)
  WHERE (current_revision_id IS NOT NULL);

CREATE INDEX pages_parent_idx ON public.pages USING btree (parent_key)
  WHERE (parent_key IS NOT NULL);

CREATE INDEX pages_redirect_idx ON public.pages USING btree (redirect_key)
  WHERE (redirect_key IS NOT NULL);

-- 삭제된 문서는 관리자에게만 보인다.
CREATE POLICY "pages_select" ON "public"."pages"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT private.can_read() AS can_read) AND ((deleted_at IS NULL) OR ( SELECT private.is_admin() AS is_admin))));

REVOKE ALL ON SEQUENCE "public"."pages_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."pages_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."pages_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."pages_id_seq" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pages" TO "service_role";

REVOKE ALL ON TABLE "public"."pages" FROM "authenticated";

GRANT SELECT ON TABLE "public"."pages" TO "authenticated";

REVOKE ALL ON TABLE "public"."pages" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."pages" TO "postgres";

REVOKE ALL ON TABLE "public"."pages" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."pages_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."pages_id_seq" FROM "authenticated";

-- ── 가명과 실제 작성자 (private) ─────────────────────────────────────────────
-- 문서마다 따로 배정한다. 여러 문서의 편집을 모아 한 사람을 추적할 수 없게 하는 장치이고,
-- 문서 사이를 잇는 정보는 이 표에만 있다.
CREATE TABLE "private"."page_pseudonyms" (
  "page_id"   bigint NOT NULL,
  "member_id" bigint NOT NULL,
  "pseudonym" text   NOT NULL,
  CONSTRAINT "page_pseudonyms_member_id_fkey" FOREIGN KEY (member_id) REFERENCES private.members(id) ON DELETE CASCADE,
  CONSTRAINT "page_pseudonyms_pkey" PRIMARY KEY (page_id, member_id),
  CONSTRAINT "page_pseudonyms_unique_per_page" UNIQUE (page_id, pseudonym),
  CONSTRAINT "page_pseudonyms_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE
);

ALTER TABLE "private"."page_pseudonyms"
  ENABLE ROW LEVEL SECURITY;

-- ── 판 ───────────────────────────────────────────────────────────────────────
-- 판마다 본문 전체를 저장한다. 판 비교와 되돌리기가 단순해진다.
--
-- 본문은 편집기(Tiptap/ProseMirror)가 내놓는 문서 JSON 그대로다(`app/features/markup/model/doc.ts`).
--   { "type": "doc", "attrs": { "categories": [...], "redirect": "..." }, "content": [블록...] }
-- 링크·틀·이미지는 노드·마크로 따로 있어 파싱 없이 그 자리를 읽는다(`private.extract_refs`).
CREATE TABLE "public"."revisions" (
  "id"                 bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "page_id"            bigint                   NOT NULL,
  "parent_revision_id" bigint,
  "body"               jsonb                    NOT NULL,
  "summary"            text                     NOT NULL DEFAULT ''::text,
  -- **이 문서에서의** 가명. 쓰는 순간 확정하고, 읽는 쪽은 실제 작성자를 참조하지 않는다.
  "author_pseudonym"   text                     NOT NULL,
  "kind"               text                     NOT NULL,
  -- 보이는 글자(`private.doc_text`)의 바이트 수. 꾸밈만 바꾼 편집은 0이다.
  "byte_size"          integer                  NOT NULL,
  "byte_delta"         integer                  NOT NULL,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  -- 관리자가 숨긴 판. 일반 사용자에게는 행 자체가 보이지 않는다.
  "hidden_at"          timestamp with time zone,
  CONSTRAINT "revisions_kind" CHECK ((kind = ANY (ARRAY['edit'::text, 'revert'::text, 'move'::text, 'delete'::text, 'restore'::text]))),
  CONSTRAINT "revisions_pkey" PRIMARY KEY (id),
  CONSTRAINT "revisions_parent_revision_id_fkey" FOREIGN KEY (parent_revision_id) REFERENCES public.revisions(id) ON DELETE SET NULL
);

ALTER TABLE "public"."revisions"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX revisions_page_idx ON public.revisions USING btree (page_id, id DESC);

-- 숨긴 판과 삭제된 문서의 판은 관리자에게만 보인다. 문서 쪽 조건은 pages 정책이 그대로 적용된다.
CREATE POLICY "revisions_select" ON "public"."revisions"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT private.can_read() AS can_read) AND ((hidden_at IS NULL) OR ( SELECT private.is_admin() AS is_admin)) AND (EXISTS ( SELECT 1
   FROM public.pages page
  WHERE (page.id = revisions.page_id)))));

REVOKE ALL ON SEQUENCE "public"."revisions_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."revisions_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."revisions_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."revisions_id_seq" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."revisions" TO "service_role";

ALTER TABLE "public"."revisions"
  ADD COLUMN "body_text" text GENERATED ALWAYS AS (private.doc_text(body)) STORED;

REVOKE ALL ON TABLE "public"."revisions" FROM "authenticated";

GRANT SELECT ON TABLE "public"."revisions" TO "authenticated";

REVOKE ALL ON TABLE "public"."revisions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."revisions" TO "postgres";

REVOKE ALL ON TABLE "public"."revisions" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."revisions_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."revisions_id_seq" FROM "authenticated";

CREATE TABLE "private"."revision_authors" (
  "revision_id" bigint                   NOT NULL,
  "member_id"   bigint                   NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "revision_authors_member_id_fkey" FOREIGN KEY (member_id) REFERENCES private.members(id) ON DELETE CASCADE,
  CONSTRAINT "revision_authors_pkey" PRIMARY KEY (revision_id),
  CONSTRAINT "revision_authors_revision_id_fkey" FOREIGN KEY (revision_id) REFERENCES public.revisions(id) ON DELETE CASCADE
);

ALTER TABLE "private"."revision_authors"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX revision_authors_member_idx ON private.revision_authors USING btree (member_id, created_at DESC);

-- ── 문서가 가리키는 것 ───────────────────────────────────────────────────────
-- 링크·틀·분류·이미지를 한 표에 둔다. 넷 다 "이 문서가 저 이름을 이런 뜻으로 가리킨다"이고,
-- 본문에서 서버가 뽑아 채운다(`private.extract_refs`). 역링크, 빨간 링크, 분류 목록, 틀 사용
-- 문서 목록, 미사용 이미지 찾기가 모두 이 표의 조회다.
CREATE TABLE "public"."page_refs" (
  "from_page_id" bigint NOT NULL,
  "kind"         text   NOT NULL,
  -- link·template·category는 제목 키, image는 이미지 id.
  "target_key"   text   NOT NULL,
  CONSTRAINT "page_refs_kind" CHECK ((kind = ANY (ARRAY['link'::text, 'template'::text, 'category'::text, 'image'::text]))),
  CONSTRAINT "page_refs_pkey" PRIMARY KEY (from_page_id, kind, target_key),
  CONSTRAINT "page_refs_from_page_id_fkey" FOREIGN KEY (from_page_id) REFERENCES public.pages(id) ON DELETE CASCADE
);

ALTER TABLE "public"."page_refs"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX page_refs_target_idx ON public.page_refs USING btree (kind, target_key);

CREATE POLICY "page_refs_select" ON "public"."page_refs"
  FOR SELECT
  TO "authenticated"
  USING ((( SELECT private.can_read() AS can_read) AND (EXISTS ( SELECT 1
   FROM public.pages page
  WHERE (page.id = page_refs.from_page_id)))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."page_refs" TO "service_role";

REVOKE ALL ON TABLE "public"."page_refs" FROM "authenticated";

GRANT SELECT ON TABLE "public"."page_refs" TO "authenticated";

REVOKE ALL ON TABLE "public"."page_refs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."page_refs" TO "postgres";

REVOKE ALL ON TABLE "public"."page_refs" FROM "anon";

CREATE OR REPLACE FUNCTION private.check_page_writable (
  p_page public.pages
)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if p_page.deleted_at is not null and not private.is_admin() then
    raise exception 'page is deleted' using errcode = 'WK008';
  end if;
  if p_page.protection = 'admin' and not private.is_admin() then
    raise exception 'page is protected' using errcode = 'WK003';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."check_page_writable"(public.pages) FROM PUBLIC;

-- 이 파일의 테이블을 가리키는 외래 키. 참조하는 테이블이 앞 파일에 있거나 서로를 참조하므로 두 테이블이
-- 모두 생긴 뒤에 붙인다.

ALTER TABLE "public"."pages"
  ADD CONSTRAINT "pages_current_revision_fkey" FOREIGN KEY (current_revision_id) REFERENCES public.revisions(id) ON DELETE SET NULL;

ALTER TABLE "public"."revisions"
  ADD CONSTRAINT "revisions_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE;
