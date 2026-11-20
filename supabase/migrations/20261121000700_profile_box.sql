SET local check_function_bodies = off;

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

CREATE OR REPLACE FUNCTION private.check_redirect_body (
  p_title text,
  p_body  jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  v_raw text := btrim(coalesce(p_body -> 'attrs' ->> 'redirect', ''));
  v_target text;
begin
  if v_raw = '' then
    return;
  end if;

  v_target := private.normalize_title(v_raw);
  if not private.is_valid_title(v_target) then
    raise exception 'invalid redirect target' using errcode = 'WK015', detail = 'target';
  end if;
  if private.title_key(v_target) = private.title_key(p_title) then
    raise exception 'redirect to itself' using errcode = 'WK015', detail = 'self';
  end if;
  -- 빈 문단만 있어야 한다(`doc_is_empty`와 같은 기준).
  if jsonb_path_exists(
    p_body,
    'strict $.content[*] ? (@.type != "paragraph" || exists(@.content[*]))'
  ) then
    raise exception 'redirect with content' using errcode = 'WK015', detail = 'content';
  end if;
  if coalesce(jsonb_array_length(p_body -> 'attrs' -> 'categories'), 0) > 0 then
    raise exception 'redirect with categories' using errcode = 'WK015', detail = 'categories';
  end if;
  -- 넘겨주기 문서는 본문을 그리지 않으므로 프로필도 둘 자리가 없다.
  if (p_body -> 'attrs') ? 'profile' then
    raise exception 'redirect with content' using errcode = 'WK015', detail = 'content';
  end if;
end;
$function$;

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
    when 'footnote' then return ' ' || coalesce(p_body -> 'attrs' ->> 'note', '');
    when 'hardBreak' then return E'\n';
    -- 이미지·영상은 아래에 보이는 캡션이 글자다(`markup/model/text.ts`의 `visibleTextLength`와 같다).
    when 'image', 'youtube' then return btrim(coalesce(p_body -> 'attrs' ->> 'caption', ''));
    else null;
  end case;

  v_separator := case when v_type in ('paragraph', 'heading', 'codeBlock') then '' else E'\n' end;
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
