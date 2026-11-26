SET local check_function_bodies = off;

DROP FUNCTION "public"."suggest_titles"(text, text, text, integer);

CREATE OR REPLACE FUNCTION private.settle_redirect_body (
  p_title text,
  p_body  jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_raw text := btrim(coalesce(p_body -> 'attrs' ->> 'redirect', ''));
  v_end record;
begin
  if v_raw = '' then
    return p_body;
  end if;
  perform pg_advisory_xact_lock(hashtext('wiki:redirect-save'));
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
  -- 제목으로 쓸 수 없는 글은 없는 문서로 친다.
  if v_key is null then
    return query select null::text, null::text, 'missing'::text;
    return;
  end if;
  for i in 1..10 loop
    if v_key = any(v_seen) then
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

REVOKE ALL ON FUNCTION "public"."resolve_redirect"(text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.revert_page (
  p_revision_id bigint,
  p_summary     text   DEFAULT ''::text
)
  RETURNS TABLE (
    page_id     bigint,
    revision_id bigint,
    title       text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_target public.revisions;
  v_page public.pages;
  v_current_body jsonb;
  v_body jsonb;
  v_summary text;
begin
  select * into v_target from public.revisions as revision where revision.id = p_revision_id;
  -- 숨긴 판은 관리자만 되살릴 수 있다. 없는 판과 같은 오류로 답해 존재를 알리지 않는다.
  if v_target.id is null or (v_target.hidden_at is not null and not private.is_admin()) then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;

  select * into v_page from public.pages as page where page.id = v_target.page_id for update;
  perform private.check_page_writable(v_page);
  -- 옛 넘겨주기 판이면 지금의 최종 문서로 바꿔 되살린다(`save_revision`과 같다). 본문 규칙
  -- (`check_redirect_body`)은 보지 않는다. 규칙 이전에 저장된 판도 되돌릴 수 있게 한다.
  v_body := private.settle_redirect_body(v_page.title, v_target.body);

  select revision.body into v_current_body
  from public.revisions as revision where revision.id = v_page.current_revision_id;
  if v_current_body = v_body then
    raise exception 'nothing to save' using errcode = 'WK007';
  end if;

  v_summary := format('r%s 판으로 되돌림', p_revision_id)
    || case when btrim(coalesce(p_summary, '')) <> '' then ': ' || btrim(p_summary) else '' end;
  perform private.check_write_limits(v_member_id, v_body, v_summary);

  page_id := v_page.id;
  title := v_page.title;
  revision_id := private.write_revision(v_page.id, v_member_id, v_body, v_summary, 'revert');
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_revision (
  p_title            text,
  p_base_revision_id bigint,
  p_body             jsonb,
  p_summary          text   DEFAULT ''::text
)
  RETURNS TABLE (
    page_id     bigint,
    revision_id bigint,
    title       text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_title text := private.normalize_title(p_title);
  v_page public.pages;
  v_body jsonb := p_body;
  v_current_body jsonb;
begin
  if not private.is_valid_title(v_title) then
    raise exception 'invalid title' using errcode = 'WK004';
  end if;
  perform private.check_body(v_body);
  perform private.check_redirect_body(v_title, v_body);
  -- 넘겨주기 대상이 넘겨주기 문서이면 최종 문서로 바꿔 저장한다. 저장하는 이 넘겨주기가 넘겨주기
  -- 문서를 가리키지 않게 한다.
  v_body := private.settle_redirect_body(v_title, v_body);
  perform private.check_write_limits(v_member_id, v_body, p_summary);

  select * into v_page from public.pages as page
  where page.title_key = lower(v_title)
  for update;

  if v_page.id is null then
    if p_base_revision_id is not null then
      raise exception 'page not found' using errcode = 'WK006';
    end if;
    if private.doc_is_empty(v_body) then
      raise exception 'nothing to save' using errcode = 'WK007';
    end if;
    begin
      insert into public.pages (title) values (v_title) returning * into v_page;
    exception when unique_violation then
      -- 같은 제목을 다른 사람이 방금 만들었다.
      raise exception 'edit conflict' using errcode = 'WK001';
    end;
  else
    perform private.check_page_writable(v_page);
    if v_page.current_revision_id is distinct from p_base_revision_id then
      raise exception 'edit conflict' using errcode = 'WK001';
    end if;
    select revision.body into v_current_body
    from public.revisions as revision where revision.id = v_page.current_revision_id;
    if v_current_body = v_body then
      raise exception 'nothing to save' using errcode = 'WK007';
    end if;
  end if;

  page_id := v_page.id;
  title := v_page.title;
  revision_id := private.write_revision(v_page.id, v_member_id, v_body, p_summary, 'edit');
  return next;
end;
$function$;

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
  -- 들어가게 한다. 대상이 있는 일반 문서이고 이 이름공간 안일 때만 준다. 아니면(없는 문서, 또 넘겨주기,
  -- `틀:옛이름` → 일반 문서) null이라 넘겨주기 문서 이름이 들어가고, 저장·링크 넣기가 대상을 푼다.
  select page.title, target.title
  from (select coalesce(p_prefix, '') as prefix) as arg
  cross join public.pages as page
  -- 접두어 뒤 부분. 걸러 내기와 순위 모두 이것을 본다.
  cross join lateral (select substr(page.title_key, length(arg.prefix) + 1) as rest) as key
  left join public.pages as target
    on target.title_key = page.redirect_key
    and target.deleted_at is null
    and target.redirect_key is null
    and starts_with(target.title_key, arg.prefix)
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

REVOKE ALL ON FUNCTION "private"."settle_redirect_body"(text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."resolve_redirect"(text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."resolve_redirect"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_redirect"(text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_redirect"(text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."suggest_titles"(text, text, text, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."suggest_titles"(text, text, text, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."suggest_titles"(text, text, text, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."suggest_titles"(text, text, text, integer) TO "service_role";
