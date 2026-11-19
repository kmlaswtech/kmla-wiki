-- 넘겨주기 정리 뒤 손질. 동작은 바꾸지 않는다.
--  * 넘겨주기 본문을 만드는 도우미 `private.redirect_doc`. 화면의 `redirectDoc`
--    (`app/features/editor/model/doc-io.ts`)과 같은 모양이다.
--  * `move_page`의 제목 키 비교를 `private.title_key`로 맞춘다.

-- `jsonb_build_object`가 stable이라 이 함수도 stable이다.
create function private.redirect_doc(p_target text) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'type', 'doc',
    'attrs', jsonb_build_object('redirect', p_target),
    'content', jsonb_build_array(jsonb_build_object('type', 'paragraph'))
  );
$$;

-- `move_page`(security definer) 안에서만 부른다.
revoke all on function private.redirect_doc(text) from public;

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
  v_new_key text := private.title_key(v_new_title);
  -- 3·4에서 넘겨줄 곳. 일반 문서면 새 이름, 넘겨주기 문서면 그 대상.
  v_destination text;
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
  if v_page.redirect_key = v_new_key then
    raise exception 'redirect to itself' using errcode = 'WK015', detail = 'self';
  end if;
  v_destination := coalesce(v_page.redirect_target, v_new_title);

  -- 1. 새 이름 자리. 대소문자나 공백만 바꾸는 이동은 같은 문서라 건너뛴다.
  if v_new_key <> v_old_key then
    select * into v_taken from public.pages as page
    where page.title_key = v_new_key
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

  -- 3. 옛 이름으로 오던 넘겨주기를 넘겨줄 곳으로. 대소문자만 바꿨다면 지금도 이 문서로 온다.
  --    삭제된 넘겨주기는 두고, 복구하면 끊긴 넘겨주기 목록에서 찾아 고친다. 넘겨줄 곳 자신은
  --    (X → 이 넘겨주기 → X 고리) 자기 자신을 가리키게 되므로 건드리지 않는다.
  if v_new_key <> v_old_key then
    for v_alias in
      select alias.id, revision.body
      from public.pages as alias
      join public.revisions as revision on revision.id = alias.current_revision_id
      where alias.redirect_key = v_old_key
        and alias.deleted_at is null
        and alias.id <> v_page.id
        and alias.title_key <> private.title_key(v_destination)
      order by alias.id
      for update of alias
    loop
      perform private.write_revision(
        v_alias.id, v_member_id,
        jsonb_set(v_alias.body, '{attrs,redirect}', to_jsonb(v_destination)),
        format('%s 이동에 따라 대상을 %s(으)로 바꿈', v_old_title, v_destination), 'edit'
      );
    end loop;
  end if;

  -- 4. 옛 이름에 넘겨주기 남기기.
  if p_leave_redirect and v_new_key <> v_old_key then
    insert into public.pages (title) values (v_old_title) returning id into v_redirect_page_id;
    perform private.write_revision(
      v_redirect_page_id, v_member_id,
      private.redirect_doc(v_destination),
      format('%s 이동으로 생긴 넘겨주기', v_new_title), 'edit'
    );
  end if;

  return next;
end;
$$;
