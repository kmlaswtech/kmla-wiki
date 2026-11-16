-- 이미지.
--
-- 흐름: 브라우저가 WebP로 바꿔 Storage에 올린다 → `register_image`로 등록한다 → 본문에
-- `![설명](img:{id})`로 넣는다. 등록하지 않은 객체는 본문에서 쓸 수 없고, 정리 대상이다.
--
-- 경로에는 사용자 정보를 넣지 않는다(`{연도}/{uuid}.webp`). 이미지는 여러 문서에 쓰일 수 있어
-- 올린 사람의 가명도 보여 주지 않는다. 누가 올렸는지는 private에만 있다(차단·훼손 대응용).
--
-- 오류 코드
--   WK005  안전 상한 초과(하루 업로드 수). detail = 'images'
--   WK006  올린 객체를 찾을 수 없음

create table public.images (
  id uuid primary key,
  storage_path text not null unique,
  width integer not null,
  height integer not null,
  bytes integer not null,
  created_at timestamptz not null default now(),
  -- 관리자가 지운 이미지. 행은 남겨 본문의 깨진 참조를 설명할 수 있게 한다.
  deleted_at timestamptz,
  constraint images_dimensions check (width between 1 and 10000 and height between 1 and 10000)
);

create table private.image_uploaders (
  image_id uuid primary key references public.images (id) on delete cascade,
  member_id bigint not null references private.members (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index image_uploaders_member_idx on private.image_uploaders (member_id, created_at desc);

alter table public.images enable row level security;
alter table private.image_uploaders enable row level security;
grant select on public.images to authenticated;

create policy images_select on public.images for select to authenticated
  using ((select private.can_read()));

-- ── Storage ──────────────────────────────────────────────────────────────────
-- 비공개 버킷. WebP만, 1MB까지. 브라우저가 올리기 전에 줄이고 다시 인코딩한다(EXIF 제거).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wiki-images', 'wiki-images', false, 1048576, array['image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 올리기: 편집 권한이 있고 경로가 규칙에 맞을 때만. 덮어쓰기(UPDATE)는 정책이 없어 막힌다.
create policy wiki_images_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'wiki-images'
    and (select private.can_edit())
    and name ~ '^[0-9]{4}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
  );

create policy wiki_images_select on storage.objects for select to authenticated
  using (bucket_id = 'wiki-images' and (select private.can_read()));

create policy wiki_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'wiki-images' and (select private.is_admin()));

-- ── 등록 ─────────────────────────────────────────────────────────────────────
-- 방금 올린 객체를 이미지로 등록한다. 크기(bytes)는 클라이언트 말이 아니라 Storage 기록에서 읽는다.
-- 가로·세로는 화면이 자리를 미리 잡는 데만 쓰는 값이라 클라이언트가 준 것을 쓴다.
create function public.register_image(p_image_id uuid, p_width integer, p_height integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_member_id bigint := private.require_editor();
  v_object record;
begin
  -- 내가 올린 객체만 등록할 수 있다.
  select object.name, (object.metadata ->> 'size')::integer as bytes
  into v_object
  from storage.objects as object
  where object.bucket_id = 'wiki-images'
    and object.name like '%/' || p_image_id::text || '.webp'
    and object.owner_id = (select auth.uid())::text;

  if v_object.name is null then
    raise exception 'uploaded object not found' using errcode = 'WK006';
  end if;

  -- 사람은 닿지 않는 상한. Storage 1GB를 스크립트로 채우는 것을 막는다.
  if not private.is_admin() and (
    select count(*) from private.image_uploaders as uploaded
    where uploaded.member_id = v_member_id
      and uploaded.created_at > now() - interval '1 day'
  ) >= 50 then
    raise exception 'too many images' using errcode = 'WK005', detail = 'images';
  end if;

  insert into public.images (id, storage_path, width, height, bytes)
  values (p_image_id, v_object.name, p_width, p_height, coalesce(v_object.bytes, 0))
  on conflict (id) do nothing;

  insert into private.image_uploaders (image_id, member_id)
  values (p_image_id, v_member_id)
  on conflict (image_id) do nothing;
end;
$$;

-- 관리자가 이미지를 지운다. Storage 객체는 클라이언트가 Storage API로 지우고(정책이 관리자만
-- 허용), 여기서는 등록을 지운 것으로 표시한다. Storage 표를 SQL로 직접 지우지 않는다.
create function public.mark_image_deleted(p_image_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.images set deleted_at = now() where id = p_image_id and deleted_at is null;
end;
$$;

revoke all on function public.register_image(uuid, integer, integer) from public, anon;
revoke all on function public.mark_image_deleted(uuid) from public, anon;
grant execute on function public.register_image(uuid, integer, integer) to authenticated;
grant execute on function public.mark_image_deleted(uuid) to authenticated;

-- ── 본문에 쓰인 이미지 정보 ──────────────────────────────────────────────────
-- 본문을 그릴 때 이미지 자리를 미리 잡을 수 있게 크기와 경로를 함께 내려 준다.
create function public.resolve_images(p_body text) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', image.id, 'path', image.storage_path, 'width', image.width, 'height', image.height
  )), '[]'::jsonb)
  from public.images as image
  where image.deleted_at is null
    and image.id::text in (
      select ref.target from private.extract_refs(p_body) as ref where ref.kind = 'image'
    );
$$;

revoke all on function public.resolve_images(text) from public, anon;
grant execute on function public.resolve_images(text) to authenticated;
