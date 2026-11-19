-- 넘겨주기 문서는 "다른 이름"일 뿐이다. 본문과 분류를 갖지 않는다.
--
-- 넘겨주기를 따라가면 넘겨주기 문서의 본문은 아무도 보지 못한다. 그런데도 편집기가 일반 문서와
-- 같아 본문을 채우는 일이 생겼다. 화면은 넘겨주기 전용 입력으로 바꾸고, 여기서 저장을 막는다.
--
-- 오류 코드. `20261116000200_pages.sql`의 표는 배포된 migration이라 고치지 않고, WK015는 여기에 둔다.
--   WK015  넘겨주기 문서 규칙 위반. detail:
--            content     본문이 있다
--            categories  분류가 있다
--            self        자기 자신으로 넘겨준다
--            target      대상 이름을 쓸 수 없다

-- ── 저장 규칙 ────────────────────────────────────────────────────────────────
-- 회원이 저장하는 경로(`save_revision`)에만 건다. 이동과 되돌리기는 규칙 이전에 저장된 본문을
-- 그대로 옮길 수 있어야 해서 검사하지 않는다.
create function private.check_redirect_body(p_title text, p_body jsonb) returns void
language plpgsql immutable set search_path = ''
as $$
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
  if lower(v_target) = lower(p_title) then
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
$$;

-- `save_revision`(security definer) 안에서만 부른다.
revoke all on function private.check_redirect_body(text, jsonb) from public;

create or replace function public.save_revision(
  p_title text,
  p_base_revision_id bigint,
  p_body jsonb,
  p_summary text default ''
)
returns table (page_id bigint, revision_id bigint, title text)
language plpgsql security definer set search_path = ''
as $$
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
$$;

-- ── 문서 보기 ────────────────────────────────────────────────────────────────
-- 바뀐 것:
--  * 넘겨주기를 3단계까지 따라간다. 순환하거나 대상이 없거나 삭제됐으면 거기서 멈춘다.
--    `redirected_from`은 처음 요청한 제목이다.
--  * 보여 줄 판이 넘겨주기면 `redirect`에 대상과 상태를 싣는다. 화면이 본문 대신 넘겨주기 카드를
--    그린다. 상태: ok(대상이 일반 문서), missing(대상이 없거나 삭제됨), redirect(대상도 넘겨주기).
create or replace function public.get_page_view(
  p_title text,
  p_follow_redirect boolean default true,
  p_revision_id bigint default null
) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_title text := private.normalize_title(p_title);
  v_page public.pages;
  v_target public.pages;
  v_seen bigint[];
  v_redirected_from text;
  v_revision public.revisions;
  v_redirect_title text;
  v_redirect jsonb;
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

  -- 보여 줄 판의 넘겨주기. 예전 판을 볼 때는 그 판의 대상이다.
  select ref.target into v_redirect_title
  from private.extract_refs(v_revision.body) as ref
  where ref.kind = 'redirect'
  limit 1;
  if v_redirect_title is not null then
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
    'children', coalesce((
      select jsonb_agg(child.title order by child.title)
      from public.pages as child
      where child.parent_key = v_page.title_key and child.deleted_at is null
    ), '[]'::jsonb),
    -- 분류 문서는 속한 문서를, 틀 문서는 쓰는 문서를 보여 준다.
    'members', case when v_page.namespace in ('category', 'template') then coalesce((
      select jsonb_agg(member.title order by member.title)
      from public.page_refs as ref
      join public.pages as member on member.id = ref.from_page_id
      where ref.kind = v_page.namespace
        and ref.target_key = v_page.title_key
        and member.deleted_at is null
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
