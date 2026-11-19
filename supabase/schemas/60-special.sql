-- 선언적 스키마 정본. 이 파일을 먼저 고치고 `pnpm db:diff <이름>`으로 migration 초안을 만든 뒤 검토한다.
--
-- 특수 문서(고립·필요한 문서, 임의 문서 등)와 제목 추천.

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.list_all_pages (
  p_namespace text    DEFAULT 'main'::text,
  p_after     text    DEFAULT NULL::text,
  p_limit     integer DEFAULT 100
)
  RETURNS TABLE (
    title text
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select page.title
  from public.pages as page
  where page.namespace = p_namespace
    and page.redirect_key is null
    and page.deleted_at is null
    and (p_after is null or page.title_key > lower(p_after))
  order by page.title_key
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$function$;

GRANT EXECUTE ON FUNCTION "public"."list_all_pages"(text, text, integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_all_pages"(text, text, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_all_pages"(text, text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_all_pages"(text, text, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_all_pages"(text, text, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.orphan_pages (
  p_after text    DEFAULT NULL::text,
  p_limit integer DEFAULT 100
)
  RETURNS TABLE (
    title text
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select page.title
  from public.pages as page
  where page.namespace = 'main'
    and page.redirect_key is null
    and page.deleted_at is null
    and (p_after is null or page.title_key > lower(p_after))
    and not exists (
      select 1 from public.pages as parent
      where parent.title_key = page.parent_key and parent.deleted_at is null
    )
    and not exists (
      select 1
      from public.page_refs as ref
      join public.pages as source on source.id = ref.from_page_id
      where ref.kind = 'link' and ref.target_key = page.title_key
        and source.id <> page.id and source.deleted_at is null
    )
    and not exists (
      select 1 from public.pages as redirect
      where redirect.redirect_key = page.title_key and redirect.deleted_at is null
    )
  order by page.title_key
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$function$;

GRANT EXECUTE ON FUNCTION "public"."orphan_pages"(text, integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."orphan_pages"(text, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."orphan_pages"(text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."orphan_pages"(text, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."orphan_pages"(text, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.suggest_titles (
  p_query   text,
  p_pattern text,
  p_prefix  text    DEFAULT ''::text,
  p_limit   integer DEFAULT 8
)
  RETURNS TABLE (
    title text,
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

GRANT EXECUTE ON FUNCTION "public"."suggest_titles"(text, text, text, integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."suggest_titles"(text, text, text, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."suggest_titles"(text, text, text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."suggest_titles"(text, text, text, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."suggest_titles"(text, text, text, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.wanted_pages (
  p_limit integer DEFAULT 100
)
  RETURNS TABLE (
    title_key text,
    ref_count integer
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select ref.target_key, count(*)::integer
  from public.page_refs as ref
  join public.pages as source on source.id = ref.from_page_id
  where ref.kind = 'link'
    and source.deleted_at is null
    and not exists (
      select 1 from public.pages as target
      where target.title_key = ref.target_key and target.deleted_at is null
    )
  group by ref.target_key
  order by count(*) desc, ref.target_key
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$function$;

GRANT EXECUTE ON FUNCTION "public"."wanted_pages"(integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."wanted_pages"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."wanted_pages"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."wanted_pages"(integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."wanted_pages"(integer) FROM PUBLIC, "anon";
