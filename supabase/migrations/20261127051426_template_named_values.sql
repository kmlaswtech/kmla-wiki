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
  v_params jsonb;
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

  -- 틀 값은 이름으로 넘긴다(`features/markup/model/template-params.ts`). 배포 전에 연 탭의 편집기는 번호
  -- 값(`template`의 `attrs.args`, `templateParam`의 `attrs.index`)을 보낸다. 받으면 값이 오류 없이
  -- 사라지므로 저장을 막는다.
  if jsonb_path_exists(p_body, 'strict $.** ? (@.type == "template").attrs.args')
     or jsonb_path_exists(p_body, 'strict $.** ? (@.type == "templateParam").attrs.index') then
    raise exception 'outdated body' using errcode = 'WK012', detail = 'template';
  end if;

  -- 값 이름은 앞뒤 빈칸이 없는 1~20자 글자다. 한 틀에 같은 이름의 값을 둘 넘기지 않는다.
  if exists (
    select
    from jsonb_path_query(
      p_body,
      'strict $.** ? (@.type == "templateArg" || @.type == "templateParam")'
    ) as node (value)
    where jsonb_typeof(node.value -> 'attrs' -> 'name') is distinct from 'string'
       or not private.is_param_name(node.value -> 'attrs' ->> 'name')
  ) or exists (
    select
    from jsonb_path_query(p_body, 'strict $.** ? (@.type == "template").content') as args (value)
    where jsonb_typeof(args.value) = 'array'
      and (select count(*) <> count(distinct arg.value -> 'attrs' ->> 'name')
           from jsonb_array_elements(args.value) as arg (value))
  ) then
    raise exception 'invalid body' using errcode = 'WK012', detail = 'template';
  end if;

  -- 틀 문서의 값 자리 설명·기본값. `{ 이름: { hint?: 글자, default?: 글자 } }`.
  v_params := p_body -> 'attrs' -> 'params';
  if v_params is not null and (
    jsonb_typeof(v_params) <> 'object'
    or exists (
      select
      from jsonb_each(v_params) as item (key, value)
      where not private.is_param_name(item.key)
         or jsonb_typeof(item.value) is distinct from 'object'
         or exists (
           select
           from jsonb_each(item.value) as field (key, value)
           where field.key not in ('hint', 'default')
              or jsonb_typeof(field.value) <> 'string'
         )
    )
  ) then
    raise exception 'invalid body' using errcode = 'WK012', detail = 'params';
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
  -- 틀에 넘긴 값(`templateArg`)은 inline 내용이다. 값과 값 사이는 줄바꿈이다.
  v_separator := case when v_type in ('paragraph', 'heading', 'codeBlock', 'footnote', 'caption', 'templateArg') then '' else E'\n' end;
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

CREATE OR REPLACE FUNCTION private.is_param_name (
  p_name text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select coalesce(p_name <> '' and p_name !~ '^\s|\s$' and char_length(p_name) <= 20, false)
$function$;

REVOKE ALL ON FUNCTION "private"."is_param_name"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."is_param_name"(text) TO "authenticated";

-- 틀 값을 번호에서 이름으로 옮긴다. 번호를 그대로 이름으로 쓴다(`args`의 첫 값 → 이름 "1", `index` 1인
-- 값 자리 → 이름 "1"). 그래서 그려지는 모양이 바뀌지 않는다. 빈 값은 넘기지 않은 것과 같이 그려졌으므로
-- 뺀다. 화면은 값 앞뒤 빈칸을 뗐으므로 여기서도 뗀다. 값 글자 안의 `{{{n}}}`(틀 안에서 바깥 틀의 값을
-- 넘기기)은 값 자리 노드로 바꾼다.
-- `body_text`는 생성 컬럼이라 다시 계산되어 값 글자가 검색에 들어간다. 판의 글자 수(`text_size`,
-- `text_added`, `text_removed`)는 저장할 때 센 값을 그대로 둔다.
CREATE FUNCTION pg_temp.template_arg_content (
  p_text text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  IMMUTABLE
  AS $function$
declare
  v_out jsonb := '[]'::jsonb;
  v_rest text := p_text;
  v_match text[];
begin
  loop
    v_match := regexp_match(v_rest, '^(.*?)\{\{\{(\d+)\}\}\}(.*)$', 's');
    exit when v_match is null;
    if v_match[1] <> '' then
      v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_match[1]));
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'type', 'templateParam', 'attrs', jsonb_build_object('name', v_match[2])));
    v_rest := v_match[3];
  end loop;
  if v_rest <> '' then
    v_out := v_out || jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_rest));
  end if;
  return v_out;
end;
$function$;

CREATE FUNCTION pg_temp.template_named_values (
  p_node jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  IMMUTABLE
  AS $function$
declare
  v_args jsonb;
  v_content jsonb;
  v_node jsonb;
  v_index text;
begin
  case jsonb_typeof(p_node)
    when 'array' then
      return coalesce(
        (select jsonb_agg(pg_temp.template_named_values(item.value) order by item.position)
         from jsonb_array_elements(p_node) with ordinality as item (value, position)),
        '[]'::jsonb);
    when 'object' then
      if p_node ->> 'type' = 'template' and jsonb_typeof(p_node -> 'attrs') = 'object'
         and p_node -> 'attrs' ? 'args' then
        v_args := p_node -> 'attrs' -> 'args';
        if jsonb_typeof(v_args) = 'array' then
          select jsonb_agg(jsonb_build_object(
                   'type', 'templateArg',
                   'attrs', jsonb_build_object('name', arg.position::text),
                   'content', pg_temp.template_arg_content(btrim(arg.value #>> '{}')))
                 order by arg.position)
          into v_content
          from jsonb_array_elements(v_args) with ordinality as arg (value, position)
          where jsonb_typeof(arg.value) = 'string' and btrim(arg.value #>> '{}') <> '';
        end if;
        v_node := (p_node - 'attrs' - 'content')
          || jsonb_build_object('attrs', (p_node -> 'attrs') - 'args');
        if v_content is not null then
          v_node := v_node || jsonb_build_object('content', v_content);
        end if;
        return v_node;
      end if;
      if p_node ->> 'type' = 'templateParam' and jsonb_typeof(p_node -> 'attrs') = 'object'
         and p_node -> 'attrs' ? 'index' then
        v_index := p_node -> 'attrs' ->> 'index';
        if v_index is null or v_index !~ '^[1-9][0-9]{0,19}$' then
          v_index := '1';
        end if;
        return p_node || jsonb_build_object(
          'attrs', ((p_node -> 'attrs') - 'index') || jsonb_build_object('name', v_index));
      end if;
      return coalesce(
        (select jsonb_object_agg(field.key, pg_temp.template_named_values(field.value))
         from jsonb_each(p_node) as field),
        '{}'::jsonb);
    else
      return p_node;
  end case;
end;
$function$;

UPDATE public.revisions
SET body = pg_temp.template_named_values(body)
WHERE jsonb_path_exists(body, 'strict $.** ? (@.type == "template" || @.type == "templateParam")');

DROP FUNCTION pg_temp.template_named_values(jsonb);

DROP FUNCTION pg_temp.template_arg_content(text);
