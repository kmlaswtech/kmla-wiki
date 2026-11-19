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
