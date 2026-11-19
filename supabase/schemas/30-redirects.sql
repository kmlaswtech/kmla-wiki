-- 선언적 스키마 정본. 이 파일을 먼저 고치고 `pnpm db:diff <이름>`으로 migration 초안을 만든 뒤 검토한다.
--
-- 넘겨주기 문서의 본문 규칙과 점검.

SET check_function_bodies = false;

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
end;
$function$;

REVOKE ALL ON FUNCTION "private"."check_redirect_body"(text, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.redirect_doc (
  p_target text
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select jsonb_build_object(
    'type', 'doc',
    'attrs', jsonb_build_object('redirect', p_target),
    'content', jsonb_build_array(jsonb_build_object('type', 'paragraph'))
  );
$function$;

REVOKE ALL ON FUNCTION "private"."redirect_doc"(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.redirect_issues (
  p_limit integer DEFAULT 500
)
  RETURNS TABLE (
    title  text,
    target text,
    next   text
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select page.title, coalesce(target.title, page.redirect_target), target.redirect_target
  from public.pages as page
  left join public.pages as target
    on target.title_key = page.redirect_key and target.deleted_at is null
  where page.redirect_key is not null
    and page.deleted_at is null
    and (target.id is null or target.redirect_key is not null)
  order by page.title_key
  limit least(greatest(coalesce(p_limit, 500), 1), 500);
$function$;

GRANT EXECUTE ON FUNCTION "public"."redirect_issues"(integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."redirect_issues"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."redirect_issues"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."redirect_issues"(integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."redirect_issues"(integer) FROM PUBLIC, "anon";

-- 넘겨주기를 끝까지 따라가 최종 문서를 찾는다. 한 행을 돌려준다.
--   status 'page':    `title`이 최종 문서다.
--   status 'missing': 쓴 이름, 또는 따라간 대상이 없는 문서다.
--   status 'loop':    넘겨주기가 돌고 돌거나 너무 길다(10단계).
--   status 'stop':    `p_stop_key` 문서에 닿았다(저장하려는 문서로 돌아오는 넘겨주기).
-- `via`는 처음 만난 넘겨주기 문서(쓴 이름이 넘겨주기가 아니면 null)다. 호출자의 권한(RLS)으로 읽는다.
-- 넘겨주기 입력과 링크 넣기가 쓴 이름의 최종 문서를 미리 확인하고, 저장(`settle_redirect_body`)이
-- 넘겨주기 대상을 최종 문서로 바꿀 때 쓴다.
CREATE OR REPLACE FUNCTION public.resolve_redirect (
  p_title    text,
  p_stop_key text DEFAULT NULL::text
)
  RETURNS TABLE (
    title  text,
    via    text,
    status text
  )
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  v_key text := private.title_key(p_title);
  v_seen text[] := array[]::text[];
  v_page record;
  v_via text;
begin
  for i in 1..10 loop
    if v_key is null or v_key = any(v_seen) then
      exit;
    end if;
    if v_key = p_stop_key then
      return query select null::text, v_via, 'stop'::text;
      return;
    end if;
    v_seen := v_seen || v_key;
    select page.title, page.redirect_key into v_page
    from public.pages as page
    where page.title_key = v_key and page.deleted_at is null;
    if not found then
      return query select null::text, v_via, 'missing'::text;
      return;
    end if;
    if v_page.redirect_key is null then
      return query select v_page.title, v_via, 'page'::text;
      return;
    end if;
    v_via := coalesce(v_via, v_page.title);
    v_key := v_page.redirect_key;
  end loop;
  return query select null::text, v_via, 'loop'::text;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."resolve_redirect"(text, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."resolve_redirect"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_redirect"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_redirect"(text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."resolve_redirect"(text, text) FROM PUBLIC, "anon";


-- 넘겨주기 본문의 대상을 최종 문서로 바꾼다. 저장(`save_revision`)이 부른다. 그래서 어느 길로 저장해도
-- 넘겨주기가 넘겨주기 문서를 가리키지 않는다. 대상 이름의 대소문자도 실제 문서에 맞춘다.
-- 없는 문서로 넘겨주는 것은 막지 않지만(규칙 이전과 같다), 넘겨주기를 거쳐 없는 문서에 닿거나
-- 돌고 돌거나 이 문서로 돌아오면 거부한다.
CREATE OR REPLACE FUNCTION private.settle_redirect_body (
  p_title text,
  p_body  jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  v_raw text := btrim(coalesce(p_body -> 'attrs' ->> 'redirect', ''));
  v_end record;
begin
  if v_raw = '' then
    return p_body;
  end if;
  select * into v_end from public.resolve_redirect(v_raw, private.title_key(p_title));
  case v_end.status
    when 'page' then
      return jsonb_set(p_body, '{attrs,redirect}', to_jsonb(v_end.title));
    when 'stop' then
      raise exception 'redirect to itself' using errcode = 'WK015', detail = 'self';
    when 'loop' then
      raise exception 'redirect loop' using errcode = 'WK015', detail = 'loop';
    else
      if v_end.via is not null then
        raise exception 'redirect to a broken redirect' using errcode = 'WK015', detail = 'broken';
      end if;
      return p_body;
  end case;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."settle_redirect_body"(text, jsonb) FROM PUBLIC;
