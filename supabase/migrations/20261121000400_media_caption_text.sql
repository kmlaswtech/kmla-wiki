-- 이미지·영상 캡션을 보이는 글자(검색, 판 크기)에 넣는다. `revisions.body_text`는 저장되는 생성
-- 컬럼이라 기존 행은 다시 계산되지 않는다. 캡션은 이 migration과 함께 처음 나가므로 다시 계산할
-- 행이 없다.
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
  if jsonb_typeof(p_body -> 'content') = 'array' then
    select string_agg(private.doc_text(child.value), v_separator order by child.position)
    into v_children
    from jsonb_array_elements(p_body -> 'content') with ordinality as child (value, position);
    v_out := case when v_out is null then v_children
                  when v_children is null then v_out
                  else v_out || v_separator || v_children end;
  end if;
  return coalesce(v_out, '');
end;
$function$;
