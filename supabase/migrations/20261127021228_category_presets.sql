SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_page_view (
  p_title           text,
  p_follow_redirect boolean DEFAULT true,
  p_revision_id     bigint  DEFAULT NULL::bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  v_title text := private.normalize_title(p_title);
  v_page public.pages;
  v_target public.pages;
  v_seen bigint[];
  v_redirected_from text;
  v_revision public.revisions;
  v_redirect_title text;
  v_redirect jsonb;
  v_members jsonb := '[]'::jsonb;
  v_presets jsonb := '[]'::jsonb;
begin
  -- 회원 확인이 지난 사용자는 RLS 때문에 모든 문서가 "없는 문서"로 보인다. 그렇게 답하면 화면이
  -- 문서를 만들라고 안내하게 되므로, 권한 오류로 알려 로그인 화면으로 보내게 한다.
  if not private.can_read() then
    raise exception 'membership verification required' using errcode = '42501';
  end if;

  select * into v_page from public.pages as page where page.title_key = lower(v_title);

  if v_page.id is not null and p_follow_redirect and p_revision_id is null then
    v_seen := array[v_page.id];
    for hop in 1..3 loop
      exit when v_page.redirect_key is null;
      -- 삭제된 문서는 없는 문서로 친다(관리자에게는 RLS가 삭제된 문서도 보여 준다).
      select * into v_target from public.pages as page
      where page.title_key = v_page.redirect_key and page.deleted_at is null;
      exit when v_target.id is null or v_target.id = any(v_seen);
      v_seen := v_seen || v_target.id;
      v_redirected_from := coalesce(v_redirected_from, v_page.title);
      v_page := v_target;
    end loop;
  end if;

  if v_page.id is null then
    return jsonb_build_object(
      'found', false,
      'title', v_title,
      'valid_title', private.is_valid_title(v_title),
      'can_edit', private.can_edit(),
      'is_admin', private.is_admin(),
      -- 없는 문서도 누가 가리키는지 보여 준다(빨간 링크를 채울 사람에게 맥락이 된다).
      'backlinks', public.page_backlinks(lower(v_title))
    );
  end if;

  select * into v_revision from public.revisions as revision
  where revision.id = coalesce(p_revision_id, v_page.current_revision_id)
    and revision.page_id = v_page.id;

  -- 보여 줄 판의 넘겨주기. 예전 판을 볼 때는 그 판의 대상이다. 본문 전체를 훑는 `extract_refs`
  -- 대신 속성 하나만 읽는다(판정 기준은 같다).
  v_redirect_title := private.normalize_title(v_revision.body -> 'attrs' ->> 'redirect');
  if private.is_valid_title(v_redirect_title) then
    select * into v_target from public.pages as page
    where page.title_key = lower(v_redirect_title) and page.deleted_at is null;
    v_redirect := jsonb_build_object(
      'target', coalesce(v_target.title, v_redirect_title),
      'state', case
        when v_target.id is null then 'missing'
        when v_target.redirect_key is not null then 'redirect'
        else 'ok'
      end,
      'next', v_target.redirect_target
    );
  end if;

  -- 분류 문서는 속한 문서를, 틀 문서는 쓰는 문서를 보여 준다. 분류에 든 문서 템플릿은 속한 문서가
  -- 아니라 `presets`에 따로 둔다(넘겨주기 템플릿은 뺀다). 틀을 쓰는 템플릿은 틀을 쓰는 문서에 그대로
  -- 든다. 접두어는 `features/presets`의 `PRESET_PREFIX`와 맞춘다.
  if v_page.namespace in ('category', 'template') then
    select
      coalesce(jsonb_agg(member.title order by member.title)
        filter (where not member_kind.is_preset), '[]'::jsonb),
      coalesce(jsonb_agg(member.title order by member.title)
        filter (where member_kind.is_preset and member.redirect_key is null), '[]'::jsonb)
    into v_members, v_presets
    from public.page_refs as ref
    join public.pages as member on member.id = ref.from_page_id
    cross join lateral (
      select v_page.namespace = 'category' and member.title_key like '위키:템플릿/%' as is_preset
    ) as member_kind
    where ref.kind = v_page.namespace
      and ref.target_key = v_page.title_key
      and member.deleted_at is null;
  end if;

  return jsonb_build_object(
    'found', true,
    'title', v_page.title,
    'redirected_from', v_redirected_from,
    'redirect', v_redirect,
    'can_edit', private.can_edit(),
    'is_admin', private.is_admin(),
    'page', jsonb_build_object(
      'id', v_page.id,
      'title', v_page.title,
      'namespace', v_page.namespace,
      'protection', v_page.protection,
      'redirect_target', v_page.redirect_target,
      'current_revision_id', v_page.current_revision_id,
      'updated_at', v_page.updated_at,
      'deleted_at', v_page.deleted_at
    ),
    'revision', case when v_revision.id is null then null else jsonb_build_object(
      'id', v_revision.id,
      'body', v_revision.body,
      'created_at', v_revision.created_at,
      'is_current', v_revision.id = v_page.current_revision_id
    ) end,
    'resolved', public.resolve_body(coalesce(v_revision.body, private.empty_doc())),
    'images', public.resolve_images(coalesce(v_revision.body, private.empty_doc())),
    'backlinks', public.page_backlinks(v_page.title_key),
    -- 문서의 토론 단추에 붙이는 수(`80-discussions`).
    'open_discussions', public.count_open_discussions(v_page.id),
    -- 문서의 별표(`90-notifications`).
    'watched', public.is_page_watched(v_page.id),
    'watchers', public.count_page_watchers(v_page.id),
    'children', coalesce((
      select jsonb_agg(child.title order by child.title)
      from public.pages as child
      where child.parent_key = v_page.title_key and child.deleted_at is null
    ), '[]'::jsonb),
    'members', v_members,
    'presets', v_presets
  );
end;
$function$;
