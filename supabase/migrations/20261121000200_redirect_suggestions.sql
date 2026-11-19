SET local check_function_bodies = off;

DROP FUNCTION "public"."suggest_titles"(text, text, text, integer);

CREATE OR REPLACE FUNCTION public.resolve_redirect (
  p_title text
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

REVOKE ALL ON FUNCTION "public"."resolve_redirect"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.suggest_titles (
  p_query   text,
  p_pattern text,
  p_prefix  text    DEFAULT ''::text,
  p_limit   integer DEFAULT 8
)
  RETURNS TABLE (
    title           text,
    redirect_target text
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  -- 넘겨주기 문서도 후보로 낸다(줄임말로 찾을 수 있게). 대신 대상을 함께 돌려주어, 고르면 대상이
  -- 들어가게 한다. 대상이 이 이름공간 밖이면(`틀:옛이름` → 일반 문서) 그 칸에 넣을 수 없으므로 null이다.
  select page.title,
    case when starts_with(page.redirect_key, arg.prefix) then page.redirect_target end
  from (select coalesce(p_prefix, '') as prefix) as arg
  cross join public.pages as page
  -- 접두어 뒤 부분. 걸러 내기와 순위 모두 이것을 본다.
  cross join lateral (select substr(page.title_key, length(arg.prefix) + 1) as rest) as key
  where page.deleted_at is null
    and starts_with(page.title_key, arg.prefix)
    and key.rest ~ coalesce(p_pattern, '')
  -- false가 먼저 온다: 정확히 → 앞부분 → 포함 → 넓혀서만 맞음.
  order by
    key.rest <> p_query,
    not starts_with(key.rest, p_query),
    strpos(key.rest, p_query) = 0,
    page.title_key
  limit least(greatest(coalesce(p_limit, 8), 1), 8);
$function$;

REVOKE ALL ON FUNCTION "public"."suggest_titles"(text, text, text, integer) FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "public"."resolve_redirect"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."resolve_redirect"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_redirect"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_redirect"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."suggest_titles"(text, text, text, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."suggest_titles"(text, text, text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."suggest_titles"(text, text, text, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."suggest_titles"(text, text, text, integer) TO "service_role";
