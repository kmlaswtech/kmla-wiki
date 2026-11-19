-- 이동과 넘겨주기 정리.
--
-- 이동(`move_page`)이 넘겨주기를 함께 정리한다. 한 트랜잭션에서 차례로:
--  1. 새 이름이 이 문서로 넘겨주는 문서이고 판이 모두 넘겨주기뿐이면, 그 문서를 지우고 그 자리로
--     옮긴다. 다른 이름을 정식 이름으로 올리는 흔한 이동이다. 지울 것이 넘겨주기뿐이라 잃는 내용이
--     없다. 보호·삭제된 넘겨주기는 관리자만 이렇게 치운다.
--  2. 문서 이름을 바꾼다.
--  3. 옛 이름으로 넘겨주던 문서를 모두 새 이름으로 고친다. 고치지 않으면 옛 이름에 넘겨주기를
--     남길 때는 이중 넘겨주기가, 남기지 않을 때는 끊긴 넘겨주기가 된다. 보호된 넘겨주기도 고친다
--     (대상 이름만 따라 바꾸는 기계적인 수정이다).
--  4. 바라면 옛 이름에 새 이름으로 가는 넘겨주기를 남긴다.
--
-- 특수 기능에 끊긴 넘겨주기와 이중 넘겨주기 목록(`redirect_issues`)을 더한다.

create or replace function public.move_page(
  p_title text,
  p_new_title text,
  p_leave_redirect boolean default true
)
returns table (page_id bigint, revision_id bigint, title text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_member_id bigint := private.require_editor();
  v_new_title text := private.normalize_title(p_new_title);
  v_page public.pages;
  v_taken public.pages;
  v_old_title text;
  v_old_key text;
  v_body jsonb;
  v_alias record;
  v_redirect_page_id bigint;
begin
  if not private.is_valid_title(v_new_title) then
    raise exception 'invalid title' using errcode = 'WK004';
  end if;

  select * into v_page from public.pages as page
  where page.title_key = private.title_key(p_title)
  for update;
  if v_page.id is null then
    raise exception 'page not found' using errcode = 'WK006';
  end if;
  perform private.check_page_writable(v_page);
  v_old_title := v_page.title;
  v_old_key := v_page.title_key;

  if v_new_title = v_old_title then
    raise exception 'nothing to save' using errcode = 'WK007';
  end if;

  -- 1. 새 이름 자리. 대소문자나 공백만 바꾸는 이동은 같은 문서라 건너뛴다.
  if lower(v_new_title) <> v_old_key then
    select * into v_taken from public.pages as page
    where page.title_key = lower(v_new_title)
    for update;
    if v_taken.id is not null then
      if v_taken.redirect_key is distinct from v_old_key
         or exists (
           select 1 from public.revisions as revision
           where revision.page_id = v_taken.id
             and coalesce(revision.body -> 'attrs' ->> 'redirect', '') = ''
         )
         or ((v_taken.protection = 'admin' or v_taken.deleted_at is not null)
             and not private.is_admin()) then
        raise exception 'title already exists' using errcode = 'WK009';
      end if;
      -- 판·가명·참조가 함께 지워진다(on delete cascade).
      delete from public.pages where id = v_taken.id;
    end if;
  end if;

  select revision.body into v_body
  from public.revisions as revision where revision.id = v_page.current_revision_id;
  v_body := coalesce(v_body, private.empty_doc());
  perform private.check_write_limits(v_member_id, v_body, '');

  -- 2. 이름 바꾸기. page id가 그대로라 판 기록과 가명이 유지된다. 하위 문서는 함께 옮기지 않는다.
  update public.pages set title = v_new_title where id = v_page.id;

  page_id := v_page.id;
  title := v_new_title;
  revision_id := private.write_revision(
    v_page.id, v_member_id, v_body,
    format('%s → %s 이동', v_old_title, v_new_title), 'move'
  );

  -- 3. 옛 이름으로 오던 넘겨주기를 새 이름으로. 대소문자만 바꿨다면 지금도 이 문서로 온다.
  --    삭제된 넘겨주기는 두고, 복구하면 끊긴 넘겨주기 목록에서 찾아 고친다.
  if lower(v_new_title) <> v_old_key then
    for v_alias in
      select alias.id, revision.body
      from public.pages as alias
      join public.revisions as revision on revision.id = alias.current_revision_id
      where alias.redirect_key = v_old_key
        and alias.deleted_at is null
        and alias.id <> v_page.id
      order by alias.id
      for update of alias
    loop
      perform private.write_revision(
        v_alias.id, v_member_id,
        jsonb_set(v_alias.body, '{attrs,redirect}', to_jsonb(v_new_title)),
        format('%s 이동에 따라 대상을 %s(으)로 바꿈', v_old_title, v_new_title), 'edit'
      );
    end loop;
  end if;

  -- 4. 옛 이름에 넘겨주기 남기기.
  if p_leave_redirect and lower(v_new_title) <> v_old_key then
    insert into public.pages (title) values (v_old_title) returning id into v_redirect_page_id;
    perform private.write_revision(
      v_redirect_page_id, v_member_id,
      jsonb_build_object(
        'type', 'doc',
        'attrs', jsonb_build_object('redirect', v_new_title),
        'content', jsonb_build_array(jsonb_build_object('type', 'paragraph'))
      ),
      format('%s 이동으로 생긴 넘겨주기', v_new_title), 'edit'
    );
  end if;

  return next;
end;
$$;

-- ── 특수 기능: 손볼 넘겨주기 ─────────────────────────────────────────────────
-- 대상이 없거나 삭제된 넘겨주기(`next`가 null)와 대상이 또 넘겨주기인 넘겨주기(`next`가 그 대상이
-- 가리키는 제목). 다른 특수 기능 목록처럼 호출자 권한으로 돌아 RLS가 적용된다.
create function public.redirect_issues(p_limit integer default 500)
returns table (title text, target text, next text)
language sql stable set search_path = ''
as $$
  select page.title, coalesce(target.title, page.redirect_target), target.redirect_target
  from public.pages as page
  left join public.pages as target
    on target.title_key = page.redirect_key and target.deleted_at is null
  where page.redirect_key is not null
    and page.deleted_at is null
    and (target.id is null or target.redirect_key is not null)
  order by page.title_key
  limit least(greatest(coalesce(p_limit, 500), 1), 500);
$$;

revoke all on function public.redirect_issues(integer) from public, anon;
grant execute on function public.redirect_issues(integer) to authenticated;
