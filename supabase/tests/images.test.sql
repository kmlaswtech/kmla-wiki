-- 이미지: 올릴 수 있는 사람과 경로, 등록, 상한.
begin;
\ir helpers.inc
select * from no_plan();

\set img1 '''0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a'''
\set img2 '''1b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a'''

select results_eq(
  $$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'wiki-images'$$,
  $$values (false, 1048576::bigint, array['image/webp'])$$,
  'the bucket is private, capped at 1MB and accepts only WebP'
);

-- ── 올리기 ───────────────────────────────────────────────────────────────────
select login(:alice);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('wiki-images', '2026/0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a.webp',
            '00000000-0000-0000-0000-0000000000a1', '{"size": 12345}')$$,
  'a member uploads to a path that follows the rule');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('wiki-images', 'alice/photo.webp', '00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'a path that does not follow the rule is rejected');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('wiki-images', '2026/1b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a.png',
            '00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, 'a non-WebP extension is rejected');
select is_empty(
  $$update storage.objects set name = '2026/1b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a.webp'
    where bucket_id = 'wiki-images' returning 1$$,
  'an uploaded object cannot be overwritten or renamed');
select logout();

-- Storage는 SQL로 직접 지우는 것을 막으므로(Storage API만 허용) 정책 정의로 확인한다.
select matches(
  (select qual::text from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'wiki_images_delete'),
  'wiki-images.*private\.is_admin\(\)',
  'only an admin may delete an image'
);

select login(:outsider);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('wiki-images', '2026/1b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a.webp',
            '00000000-0000-0000-0000-000000000000')$$,
  '42501', null, 'a non-member cannot upload');
select is_empty($$select 1 from storage.objects where bucket_id = 'wiki-images'$$,
  'nor see uploaded objects');
select logout();

insert into private.bans (member_id, reason)
select id, '훼손' from private.members where kmla_profile_id = 9002;
select login(:bob);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('wiki-images', '2026/1b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a.webp',
            '00000000-0000-0000-0000-0000000000b0')$$,
  '42501', null, 'a banned member cannot upload');
select isnt_empty($$select 1 from storage.objects where bucket_id = 'wiki-images'$$,
  'but can still load images');

-- ── 등록 ─────────────────────────────────────────────────────────────────────
select throws_ok(format($$select public.register_image(%L, 800, 600)$$, :img1), 'WK002', null,
  'a banned member cannot register an image');
select logout();
update private.bans set lifted_at = now();

select login(:bob);
select throws_ok(format($$select public.register_image(%L, 800, 600)$$, :img1), 'WK006', null,
  'a member cannot register an object someone else uploaded');
select logout();

select login(:alice);
select throws_ok(format($$select public.register_image(%L, 800, 600)$$, :img2), 'WK006', null,
  'an image that was never uploaded cannot be registered');
select lives_ok(format($$select public.register_image(%L, 800, 600)$$, :img1),
  'the uploader registers the image');
select results_eq(
  format($$select storage_path, width, height, bytes from public.images where id = %L$$, :img1),
  $$values ('2026/0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a.webp'::text, 800, 600, 12345)$$,
  'the size comes from the storage record, not from the client'
);
select is(
  public.resolve_images('![지도](img:0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a) ![없음](img:1b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a)'),
  '[{"id": "0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a", "path": "2026/0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a.webp", "width": 800, "height": 600}]'::jsonb,
  'a body resolves to the registered images it uses'
);
select throws_ok($$select * from private.image_uploaders$$, '42501', null,
  'who uploaded an image is not readable');
select throws_ok(format($$select public.mark_image_deleted(%L)$$, :img1), '42501', null,
  'a member cannot mark an image deleted');
select logout();

-- ── 하루 상한 ────────────────────────────────────────────────────────────────
with made as (
  insert into public.images (id, storage_path, width, height, bytes)
  select gen_random_uuid(), 'x/' || n, 1, 1, 1 from generate_series(1, 50) as n
  returning id
)
insert into private.image_uploaders (image_id, member_id)
select made.id, (select id from private.members where kmla_profile_id = 9001) from made;

insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('wiki-images', '2026/1b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a.webp',
        '00000000-0000-0000-0000-0000000000a1', '{"size": 1}');
select login(:alice);
select throws_ok(format($$select public.register_image(%L, 1, 1)$$, :img2), 'WK005', null,
  'fifty images in a day trips the safety limit');
select logout();

select login(:admin);
select lives_ok(format($$select public.mark_image_deleted(%L)$$, :img1), 'an admin marks an image deleted');
select is(
  public.resolve_images('![지도](img:0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a)'), '[]'::jsonb,
  'a deleted image no longer resolves');
select logout();

select * from finish();
rollback;
