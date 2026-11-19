-- 선언적 스키마 정본. 이 파일을 먼저 고치고 `pnpm db:diff <이름>`으로 migration 초안을 만든 뒤 검토한다.
--
-- 이미지 등록과 `wiki-images` Storage 정책. 버킷 행은 DML이라 migration에만 있다.

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.mark_image_deleted (
  p_image_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not private.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.images set deleted_at = now() where id = p_image_id and deleted_at is null;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."mark_image_deleted"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."mark_image_deleted"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."mark_image_deleted"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."mark_image_deleted"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."mark_image_deleted"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.register_image (
  p_image_id uuid,
  p_width    integer,
  p_height   integer
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."register_image"(uuid, integer, integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."register_image"(uuid, integer, integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."register_image"(uuid, integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."register_image"(uuid, integer, integer) TO "postgres";

REVOKE ALL ON FUNCTION "public"."register_image"(uuid, integer, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.resolve_images (
  p_body jsonb
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', image.id, 'path', image.storage_path, 'width', image.width, 'height', image.height
  )), '[]'::jsonb)
  from public.images as image
  where image.deleted_at is null
    and image.id::text in (
      select ref.target from private.extract_refs(p_body) as ref where ref.kind = 'image'
    );
$function$;

GRANT EXECUTE ON FUNCTION "public"."resolve_images"(jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."resolve_images"(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_images"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_images"(jsonb) TO "postgres";

REVOKE ALL ON FUNCTION "public"."resolve_images"(jsonb) FROM PUBLIC, "anon";

CREATE TABLE "public"."images" (
  "id"           uuid                     NOT NULL,
  "storage_path" text                     NOT NULL,
  "width"        integer                  NOT NULL,
  "height"       integer                  NOT NULL,
  "bytes"        integer                  NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  -- 관리자가 지운 이미지. 행은 남겨 본문의 깨진 참조를 설명할 수 있게 한다.
  "deleted_at"   timestamp with time zone,
  CONSTRAINT "images_dimensions" CHECK ((((width >= 1) AND (width <= 10000)) AND ((height >= 1) AND (height <= 10000)))),
  CONSTRAINT "images_pkey" PRIMARY KEY (id),
  CONSTRAINT "images_storage_path_key" UNIQUE (storage_path)
);

ALTER TABLE "public"."images"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "images_select" ON "public"."images"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.can_read() AS can_read));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."images" TO "service_role";

REVOKE ALL ON TABLE "public"."images" FROM "authenticated";

GRANT SELECT ON TABLE "public"."images" TO "authenticated";

REVOKE ALL ON TABLE "public"."images" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."images" TO "postgres";

REVOKE ALL ON TABLE "public"."images" FROM "anon";

CREATE TABLE "private"."image_uploaders" (
  "image_id"   uuid                     NOT NULL,
  "member_id"  bigint                   NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "image_uploaders_pkey" PRIMARY KEY (image_id),
  CONSTRAINT "image_uploaders_member_id_fkey" FOREIGN KEY (member_id) REFERENCES private.members(id) ON DELETE CASCADE,
  CONSTRAINT "image_uploaders_image_id_fkey" FOREIGN KEY (image_id) REFERENCES public.images(id) ON DELETE CASCADE
);

ALTER TABLE "private"."image_uploaders"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX image_uploaders_member_idx ON private.image_uploaders USING btree (member_id, created_at DESC);

CREATE POLICY "wiki_images_delete" ON "storage"."objects"
  FOR DELETE
  TO "authenticated"
  USING (((bucket_id = 'wiki-images'::text) AND ( SELECT private.is_admin() AS is_admin)));

-- 올리기: 편집 권한이 있고 경로가 규칙에 맞을 때만. 덮어쓰기(UPDATE)는 정책이 없어 막힌다.
CREATE POLICY "wiki_images_insert" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    (((bucket_id = 'wiki-images'::text) AND ( SELECT private.can_edit() AS can_edit) AND (name ~
    '^[0-9]{4}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'::text)));

CREATE POLICY "wiki_images_select" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'wiki-images'::text) AND ( SELECT private.can_read() AS can_read)));
