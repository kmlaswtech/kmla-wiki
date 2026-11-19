SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.page_sizes (
  p_namespace text    DEFAULT 'main'::text,
  p_longest   boolean DEFAULT false,
  p_offset    integer DEFAULT 0,
  p_limit     integer DEFAULT 100
)
  RETURNS TABLE (
    title     text,
    byte_size integer
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select page.title, revision.byte_size
  from public.pages as page
  join public.revisions as revision on revision.id = page.current_revision_id
  where page.namespace = p_namespace
    and page.redirect_key is null
    and page.deleted_at is null
  order by
    case when p_longest then -revision.byte_size else revision.byte_size end,
    page.title_key
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$function$;

REVOKE ALL ON FUNCTION "public"."page_sizes"(text, boolean, integer, integer) FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "public"."page_sizes"(text, boolean, integer, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."page_sizes"(text, boolean, integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."page_sizes"(text, boolean, integer, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."page_sizes"(text, boolean, integer, integer) TO "service_role";
