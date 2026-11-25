SET local check_function_bodies = off;

DROP FUNCTION "public"."list_author_edits"(text, bigint, integer);

DROP FUNCTION "public"."page_sizes"(text, boolean, integer, integer);

CREATE OR REPLACE FUNCTION private.common_affix_length (
  p_a text,
  p_b text
)
  RETURNS integer
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  v_prefix integer := private.common_prefix_length(p_a, p_b);
begin
  return v_prefix + private.common_prefix_length(
    reverse(substr(p_a, v_prefix + 1)), reverse(substr(p_b, v_prefix + 1))
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.common_prefix_length (
  p_a text,
  p_b text
)
  RETURNS integer
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  v_low integer := 0;
  v_high integer := least(char_length(p_a), char_length(p_b));
  v_mid integer;
begin
  while v_low < v_high loop
    v_mid := (v_low + v_high + 1) / 2;
    if left(p_a, v_mid) collate "C" = left(p_b, v_mid) collate "C" then
      v_low := v_mid;
    else
      v_high := v_mid - 1;
    end if;
  end loop;
  return v_low;
end;
$function$;

CREATE OR REPLACE FUNCTION private.pieces_change (
  p_old     text[],
  p_new     text[],
  p_by_word boolean,
  OUT       added integer,
  OUT       removed integer
)
  RETURNS record
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
  v_old text[];
  v_new text[];
  v_used boolean[];
  v_best integer;
  v_best_affix integer;
  v_affix integer;
  v_ordered boolean;
  v_pairs bigint;
  v_inner record;
begin
  added := 0;
  removed := 0;
  -- 꾸밈만 바꾼 편집처럼 글자가 같으면 견줄 것이 없다.
  if p_old = p_new then
    return;
  end if;

  -- 같은 조각은 개수까지 맞춘다(`nth`: 같은 조각 가운데 몇 번째). full join은 해시·병합 조인으로만 돈다.
  -- `not exists`는 계획에 따라 중첩 반복(조각 수의 제곱)이 된다. 두 쪽 번호 매기기를 함수로 빼면 인라인되지
  -- 않아 느려지므로 질의 안에 둔다.
  select
    coalesce(array_agg(o.piece order by o.pos) filter (where n.piece is null), '{}'),
    coalesce(array_agg(n.piece order by n.pos) filter (where o.piece is null), '{}')
  into v_old, v_new
  from (
    select part.piece, part.pos, row_number() over (partition by part.piece order by part.pos) as nth
    from unnest(p_old) with ordinality as part (piece, pos) where part.piece <> ''
  ) as o
  full join (
    select part.piece, part.pos, row_number() over (partition by part.piece order by part.pos) as nth
    from unnest(p_new) with ordinality as part (piece, pos) where part.piece <> ''
  ) as n on n.piece = o.piece and n.nth = o.nth;

  v_used := array_fill(false, array[cardinality(v_new)]);
  -- 한 쌍을 견주는 값은 조각 길이에 비례한다. 쌍 수와 견줄 글자 양(쌍 수 × 평균 길이)에 한도를 둔다.
  -- 짧은 조각은 많이, 긴 줄은 적게 모두 견준다.
  v_pairs := cardinality(v_old)::bigint * cardinality(v_new);
  v_ordered := v_pairs > 10000 or v_pairs * (
    select coalesce(avg(char_length(piece)), 0) from unnest(v_old || v_new) as piece
  ) > 5000000;
  for i in 1 .. cardinality(v_old) loop
    v_best := null;
    v_best_affix := 0;
    if v_ordered then
      if i <= cardinality(v_new) then
        v_best := i;
        v_best_affix := private.common_affix_length(v_old[i], v_new[i]);
      end if;
    else
      for j in 1 .. cardinality(v_new) loop
        continue when v_used[j];
        v_affix := private.common_affix_length(v_old[i], v_new[j]);
        if v_affix > v_best_affix then
          v_best := j;
          v_best_affix := v_affix;
        end if;
      end loop;
    end if;

    if v_best is null then
      removed := removed + char_length(v_old[i]);
      continue;
    end if;
    v_used[v_best] := true;
    if p_by_word and not v_ordered then
      -- 띄어쓰기 뒤에서 나눈다(띄어쓰기는 앞 낱말에 붙는다).
      v_inner := private.pieces_change(
        regexp_split_to_array(v_old[i], '(?<= )'), regexp_split_to_array(v_new[v_best], '(?<= )'), false
      );
      added := added + v_inner.added;
      removed := removed + v_inner.removed;
    else
      removed := removed + char_length(v_old[i]) - v_best_affix;
      added := added + char_length(v_new[v_best]) - v_best_affix;
    end if;
  end loop;
  for j in 1 .. cardinality(v_new) loop
    if not v_used[j] then
      added := added + char_length(v_new[j]);
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION private.text_change (
  p_old text,
  p_new text,
  OUT   added integer,
  OUT   removed integer
)
  RETURNS record
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select change.added, change.removed
  from private.pieces_change(
    string_to_array(coalesce(p_old, ''), E'\n'), string_to_array(coalesce(p_new, ''), E'\n'), true
  ) as change;
$function$;

CREATE OR REPLACE FUNCTION private.text_length (
  p_text text
)
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select char_length(replace(coalesce(p_text, ''), E'\n', ''));
$function$;

-- 바이트 크기·변화량을 글자 수와 더한·뺀 글자 수로 바꾼다. 새 열을 비운 채 더하고, 판마다 앞 판
-- (`parent_revision_id`, 저장할 때의 현재 판)과 견주어 채운 뒤에 not null을 건다.
ALTER TABLE "public"."revisions"
  ADD COLUMN "text_size" integer;

ALTER TABLE "public"."revisions"
  ADD COLUMN "text_added" integer;

ALTER TABLE "public"."revisions"
  ADD COLUMN "text_removed" integer;

UPDATE public.revisions AS revision
   SET text_size = private.text_length(revision.body_text),
       (text_added, text_removed) = (
         SELECT change.added, change.removed
         FROM private.text_change(
           (SELECT parent.body_text FROM public.revisions AS parent WHERE parent.id = revision.parent_revision_id),
           revision.body_text
         ) AS change
       );

ALTER TABLE "public"."revisions"
  ALTER COLUMN "text_size" SET NOT NULL,
  ALTER COLUMN "text_added" SET NOT NULL,
  ALTER COLUMN "text_removed" SET NOT NULL;

ALTER TABLE "public"."revisions"
  DROP COLUMN "byte_delta";

ALTER TABLE "public"."revisions"
  DROP COLUMN "byte_size";

CREATE OR REPLACE FUNCTION private.write_revision (
  p_page_id   bigint,
  p_member_id bigint,
  p_body      jsonb,
  p_summary   text,
  p_kind      text,
  p_as_admin  boolean DEFAULT false
)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_parent_id bigint;
  v_parent_text text;
  v_revision_id bigint;
  v_text text := private.doc_text(p_body);
  v_change record;
begin
  select page.current_revision_id, revision.body_text
  into v_parent_id, v_parent_text
  from public.pages as page
  left join public.revisions as revision on revision.id = page.current_revision_id
  where page.id = p_page_id;
  v_change := private.text_change(v_parent_text, v_text);

  insert into public.revisions (
    page_id, parent_revision_id, body, summary, author_pseudonym, kind, text_size, text_added, text_removed
  )
  values (
    p_page_id,
    v_parent_id,
    p_body,
    coalesce(btrim(p_summary), ''),
    case when p_as_admin then '관리자' else private.pseudonym_for(p_page_id, p_member_id) end,
    p_kind,
    private.text_length(v_text),
    v_change.added,
    v_change.removed
  )
  returning id into v_revision_id;

  insert into private.revision_authors (revision_id, member_id)
  values (v_revision_id, p_member_id);

  -- 본문에서 뽑는 일은 한 번만 한다. 넘겨주기 대상과 나머지 참조를 같은 결과에서 나눈다.
  delete from public.page_refs where from_page_id = p_page_id;
  with refs as materialized (
    select ref.kind, ref.target from private.extract_refs(p_body) as ref
  ),
  updated as (
    update public.pages
       set current_revision_id = v_revision_id,
           updated_at = now(),
           redirect_target = (select refs.target from refs where refs.kind = 'redirect' limit 1)
     where id = p_page_id
  )
  insert into public.page_refs (from_page_id, kind, target_key)
  select distinct p_page_id, refs.kind, lower(refs.target)
  from refs
  where refs.kind <> 'redirect';

  return v_revision_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_author_edits (
  p_lookup_id          text,
  p_before_revision_id bigint  DEFAULT NULL::bigint,
  p_limit              integer DEFAULT 50
)
  RETURNS TABLE (
    revision_id        bigint,
    page_id            bigint,
    page_title         text,
    pseudonym          text,
    kind               text,
    summary            text,
    text_added         integer,
    text_removed       integer,
    created_at         timestamp with time zone,
    parent_revision_id bigint,
    is_current         boolean,
    hidden_at          timestamp with time zone,
    page_deleted       boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_target_id bigint;
begin
  perform private.require_admin();
  v_target_id := (private.author_lookup(p_lookup_id)).target_member_id;

  return query
  select
    revision.id, page.id, page.title, revision.author_pseudonym, revision.kind, revision.summary,
    revision.text_added, revision.text_removed, revision.created_at, revision.parent_revision_id,
    revision.id = page.current_revision_id, revision.hidden_at, page.deleted_at is not null
  from private.revision_authors as author
  join public.revisions as revision on revision.id = author.revision_id
  join public.pages as page on page.id = revision.page_id
  where author.member_id = v_target_id
    and (p_before_revision_id is null or revision.id < p_before_revision_id)
  order by revision.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 500);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_author_edits"(text, bigint, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.page_sizes (
  p_namespace text    DEFAULT 'main'::text,
  p_longest   boolean DEFAULT false,
  p_offset    integer DEFAULT 0,
  p_limit     integer DEFAULT 100
)
  RETURNS TABLE (
    title     text,
    text_size integer
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select page.title, revision.text_size
  from public.pages as page
  join public.revisions as revision on revision.id = page.current_revision_id
  where page.namespace = p_namespace
    and page.redirect_key is null
    and page.deleted_at is null
  order by
    case when p_longest then -revision.text_size else revision.text_size end,
    page.title_key
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$function$;

REVOKE ALL ON FUNCTION "public"."page_sizes"(text, boolean, integer, integer) FROM PUBLIC, "anon";

REVOKE ALL ON FUNCTION "private"."common_affix_length"(text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."common_prefix_length"(text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."pieces_change"(text[], text[], boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."text_change"(text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."text_length"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(text, bigint, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_author_edits"(text, bigint, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(text, bigint, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_author_edits"(text, bigint, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."page_sizes"(text, boolean, integer, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."page_sizes"(text, boolean, integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."page_sizes"(text, boolean, integer, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."page_sizes"(text, boolean, integer, integer) TO "service_role";
