SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.ban_history (
  p_revision_id bigint
)
  RETURNS TABLE (
    total  integer,
    lifted integer,
    active boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint;
begin
  perform private.require_admin();
  select target.member_id into v_member_id from private.revision_target(p_revision_id) as target;
  if v_member_id is null then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;
  return query
    select
      (count(*) filter (where ban.lifted_at is not null or ban.ends_at <= now()))::integer,
      (count(*) filter (where ban.lifted_at is not null))::integer,
      private.member_is_banned(v_member_id)
    from private.bans as ban
    where ban.member_id = v_member_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."ban_history"(bigint) FROM PUBLIC, "anon";

GRANT EXECUTE ON FUNCTION "public"."ban_history"(bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."ban_history"(bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."ban_history"(bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."ban_history"(bigint) TO "service_role";
