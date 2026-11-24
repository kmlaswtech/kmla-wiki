SET local check_function_bodies = off;

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

-- 이미지·영상의 캡션을 `attrs.caption`(글자)에서 캡션 노드(`content`)로 옮긴다.
-- 모든 이미지·영상은 캡션 노드 하나를 가진다(편집기가 그렇게 저장한다). 빈 캡션은 내용 없는 캡션 노드다.
-- 캡션 앞뒤 빈칸은 화면에 보이지 않았으므로 뗀다. `body_text`는 생성 컬럼이라 함께 다시 계산된다.
-- 캡션 글자에는 링크가 없었으므로 `page_refs`는 바뀌지 않는다.
CREATE FUNCTION pg_temp.media_caption_content (
  p_node jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  IMMUTABLE
  AS $function$
declare
  v_attrs jsonb;
  v_caption text;
  v_node jsonb;
begin
  case jsonb_typeof(p_node)
    when 'array' then
      return coalesce(
        (select jsonb_agg(pg_temp.media_caption_content(item.value) order by item.position)
         from jsonb_array_elements(p_node) with ordinality as item (value, position)),
        '[]'::jsonb);
    when 'object' then
      if p_node ->> 'type' in ('image', 'youtube') and p_node -> 'content' is null then
        v_caption := btrim(coalesce(p_node -> 'attrs' ->> 'caption', ''));
        v_node := p_node;
        if jsonb_typeof(p_node -> 'attrs') = 'object' then
          v_attrs := (p_node -> 'attrs') - 'caption';
          v_node := v_node - 'attrs';
          if v_attrs <> '{}'::jsonb then
            v_node := v_node || jsonb_build_object('attrs', v_attrs);
          end if;
        end if;
        return v_node || jsonb_build_object('content', jsonb_build_array(
          case when v_caption = '' then jsonb_build_object('type', 'caption')
               else jsonb_build_object('type', 'caption', 'content',
                      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_caption)))
          end));
      end if;
      return coalesce(
        (select jsonb_object_agg(field.key, pg_temp.media_caption_content(field.value))
         from jsonb_each(p_node) as field),
        '{}'::jsonb);
    else
      return p_node;
  end case;
end;
$function$;

UPDATE public.revisions
SET body = pg_temp.media_caption_content(body)
WHERE jsonb_path_exists(body, 'strict $.** ? (@.type == "image" || @.type == "youtube")');

DROP FUNCTION pg_temp.media_caption_content(jsonb);
