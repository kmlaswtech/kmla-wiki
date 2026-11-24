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
    -- 이미지·영상은 아래에 보이는 캡션이 글자다(`markup/model/text.ts`의 `visibleTextLength`와 같다).
    when 'image', 'youtube' then return btrim(coalesce(p_body -> 'attrs' ->> 'caption', ''));
    else null;
  end case;

  v_separator := case when v_type in ('paragraph', 'heading', 'codeBlock', 'footnote') then '' else E'\n' end;
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

-- 각주 내용을 `attrs.note`(글자)에서 노드 내용(`content`)으로 옮긴다(이슈 #40).
-- 글자는 글자 노드 하나가 된다. 빈 각주는 내용 없이 남는다. `body_text`는 생성 컬럼이라 함께 다시 계산된다.
-- 각주 글자에는 링크가 없었으므로 `page_refs`는 바뀌지 않는다.
CREATE FUNCTION pg_temp.footnote_content (
  p_node jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  IMMUTABLE
  AS $function$
declare
  v_attrs jsonb;
  v_note text;
begin
  case jsonb_typeof(p_node)
    when 'array' then
      return coalesce(
        (select jsonb_agg(pg_temp.footnote_content(item.value) order by item.position)
         from jsonb_array_elements(p_node) with ordinality as item (value, position)),
        '[]'::jsonb);
    when 'object' then
      if p_node ->> 'type' = 'footnote' and jsonb_typeof(p_node -> 'attrs') = 'object'
         and p_node -> 'attrs' ? 'note' then
        v_note := p_node -> 'attrs' ->> 'note';
        v_attrs := (p_node -> 'attrs') - 'note';
        p_node := p_node - 'attrs';
        if v_attrs <> '{}'::jsonb then
          p_node := p_node || jsonb_build_object('attrs', v_attrs);
        end if;
        if coalesce(v_note, '') <> '' then
          p_node := p_node || jsonb_build_object(
            'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_note)));
        end if;
        return p_node;
      end if;
      return coalesce(
        (select jsonb_object_agg(field.key, pg_temp.footnote_content(field.value))
         from jsonb_each(p_node) as field),
        '{}'::jsonb);
    else
      return p_node;
  end case;
end;
$function$;

UPDATE public.revisions
SET body = pg_temp.footnote_content(body)
WHERE jsonb_path_exists(body, 'strict $.** ? (@.type == "footnote").attrs.note');

DROP FUNCTION pg_temp.footnote_content(jsonb);
