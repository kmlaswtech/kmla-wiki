-- 관리자가 한 사람의 편집을 여러 문서에서 한 번에 되돌리게 하고, 회원이 판을 관리자에게 신고하게 한다.
--
-- 오류 코드. 배포된 migration의 표는 고치지 않고, 새 코드와 새 뜻은 여기에 더한다.
--   WK018  일괄 되돌리기는 한 번에 200개 문서까지
--   WK019  신고는 1시간에 10건까지
-- 신고(`report_revision`)가 기존 코드를 쓰는 뜻:
--   WK005  덧붙임이 300자를 넘는다(detail = 'note')
--   WK006  없거나 숨긴 판, 삭제된 문서의 판이다
--   WK011  같은 판에 대한 내 신고가 아직 처리되지 않았거나 이미 기각되었다
--   WK014  종류가 기타인데 덧붙임이 2자보다 짧다
-- 신고 닫기(`resolve_reports`)의 WK011은 그 판에 처리되지 않은 신고가 없다는 뜻이다.
-- 되돌리고 숨기기(`revert_and_hide_revision`)는 `set_revision_hidden`의 코드를 그대로 쓴다.

SET local check_function_bodies = off;

ALTER TABLE "public"."admin_log"
  DROP CONSTRAINT "admin_log_action";

CREATE TABLE "private"."reports" (
  "id"                    bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "revision_id"           bigint                   NOT NULL,
  "reporter_member_id"    bigint,
  "category"              text                     NOT NULL,
  "note"                  text                     NOT NULL DEFAULT ''::text,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at"           timestamp with time zone,
  "resolved_by_member_id" bigint,
  "resolution"            text,
  CONSTRAINT "reports_category" CHECK ((category = ANY (ARRAY['privacy'::text, 'abuse'::text, 'vandalism'::text, 'other'::text]))),
  CONSTRAINT "reports_pkey" PRIMARY KEY (id),
  CONSTRAINT "reports_resolution" CHECK ((((resolved_at IS NULL) AND (resolution IS NULL)) OR ((resolved_at IS
    NOT NULL) AND (resolution = ANY (ARRAY['handled'::text, 'dismissed'::text])))))
);

ALTER TABLE "private"."reports"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.bulk_revert_plan (
  p_target_id        bigint,
  p_from_revision_id bigint,
  p_page_ids         bigint[] DEFAULT NULL::bigint[]
)
  RETURNS TABLE (
    page_id             bigint,
    page_title          text,
    current_revision_id bigint,
    restore_revision_id bigint,
    edit_count          integer,
    kept_count          integer,
    has_move            boolean,
    move_leftover       boolean,
    status              text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  with bad as materialized (
    select revision.id, revision.page_id, revision.kind
    from private.revision_authors as author
    join public.revisions as revision on revision.id = author.revision_id
    where author.member_id = p_target_id
      and revision.id >= coalesce(p_from_revision_id, 0)
      and (p_page_ids is null or revision.page_id = any (p_page_ids))
  ),
  touched as (
    select bad.page_id, min(bad.id) as first_bad_id from bad group by bad.page_id
  ),
  planned as (
    select
      page.id, page.title, page.current_revision_id, page.deleted_at,
      exists (select 1 from bad where bad.id = page.current_revision_id) as current_is_bad,
      -- 대상의 판이 아닌 마지막 판. 판 색인(`revisions_page_idx`)을 최신부터 읽어 처음 만나는 판이다.
      (
        select revision.id from public.revisions as revision
        where revision.page_id = page.id
          and not exists (select 1 from bad where bad.id = revision.id)
        order by revision.id desc
        limit 1
      ) as restore_id,
      -- 대상의 첫 편집 바로 앞 판. 현재 본문이 이것과 같으면 누군가 이미 되돌렸다.
      (
        select revision.id from public.revisions as revision
        where revision.page_id = page.id and revision.id < touched.first_bad_id
        order by revision.id desc
        limit 1
      ) as before_id
    from touched
    join public.pages as page on page.id = touched.page_id
  ),
  -- 되돌리면 걷어 낼 판(`removed`)과 남는 판. 충돌이나 삭제된 문서면 이 문서에서 대상이 쓴 판 전부를
  -- 걷어 낼 판으로 센다(보이기만 한다).
  counted as (
    select
      planned.id as page_id,
      count(*) filter (where flag.removed)::integer as edit_count,
      count(*) filter (where not flag.removed)::integer as kept_count,
      coalesce(bool_or(bad.kind = 'move') filter (where flag.removed), false) as has_move
    from planned
    join bad on bad.page_id = planned.id
    cross join lateral (
      select planned.deleted_at is not null
          or not planned.current_is_bad
          or bad.id > coalesce(planned.restore_id, 0) as removed
    ) as flag
    group by planned.id
  )
  select
    planned.id,
    planned.title,
    planned.current_revision_id,
    planned.restore_id,
    counted.edit_count,
    counted.kept_count,
    counted.has_move,
    -- 이동이 남긴 넘겨주기: 문서의 첫 판이 대상의 이동 판과 같은 트랜잭션(같은 시각)에 쓰였다.
    -- 대상의 판만 시각 색인(`revision_authors_member_idx`)으로 찾는다.
    case when planned.restore_id is null then exists (
      select 1
      from public.revisions as first_revision
      join private.revision_authors as mover
        on mover.member_id = p_target_id and mover.created_at = first_revision.created_at
      join public.revisions as moved on moved.id = mover.revision_id and moved.kind = 'move'
      where first_revision.id = (
          select min(revision.id) from public.revisions as revision where revision.page_id = planned.id
        )
    ) else false end,
    case
      when planned.deleted_at is not null then 'deleted'
      when not planned.current_is_bad then
        case when before_rev.body = current_rev.body then 'clean' else 'conflict' end
      when planned.restore_id is null then 'delete'
      when restore_rev.hidden_at is not null then 'hidden'
      when private.settle_redirect_body(planned.title, restore_rev.body) = current_rev.body then 'same'
      else 'revert'
    end
  from planned
  join counted on counted.page_id = planned.id
  left join public.revisions as current_rev on current_rev.id = planned.current_revision_id
  left join public.revisions as restore_rev on restore_rev.id = planned.restore_id
  left join public.revisions as before_rev on before_rev.id = planned.before_id
  order by planned.current_revision_id desc;
$function$;

CREATE OR REPLACE FUNCTION private.close_reports (
  p_revision_ids bigint[]
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_count integer;
begin
  update private.reports
     set resolved_at = now(), resolved_by_member_id = private.current_member_id(), resolution = 'handled'
   where revision_id = any (p_revision_ids) and resolved_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION private.delete_page_as_admin (
  p_page_id  bigint,
  p_admin_id bigint,
  p_body     jsonb,
  p_summary  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.write_revision(p_page_id, p_admin_id, p_body, p_summary, 'delete', true);
  update public.pages set deleted_at = now() where id = p_page_id;
  perform private.close_reports(array(select revision.id from public.revisions as revision where revision.page_id = p_page_id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_revert (
  p_lookup_id        text,
  p_from_revision_id bigint,
  p_items            jsonb,
  p_reason           text
)
  RETURNS TABLE (
    page_id    bigint,
    page_title text,
    outcome    text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_admin_id bigint := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_lookup private.author_lookups;
  v_expected jsonb;
  v_page_ids bigint[];
  v_plan record;
  v_body jsonb;
  v_source record;
  v_reverted integer := 0;
  v_deleted integer := 0;
begin
  v_lookup := private.author_lookup(p_lookup_id);
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;

  -- 문서 id → 미리보기 때의 현재 판.
  select
    coalesce(jsonb_object_agg(item ->> 'page_id', item -> 'current_revision_id'), '{}'::jsonb),
    coalesce(array_agg(distinct (item ->> 'page_id')::bigint), '{}')
  into v_expected, v_page_ids
  from jsonb_array_elements(p_items) as item;
  if cardinality(v_page_ids) = 0 then
    raise exception 'nothing to save' using errcode = 'WK007';
  end if;
  if cardinality(v_page_ids) > 200 then
    raise exception 'too many pages' using errcode = 'WK018';
  end if;

  -- 문서를 id 순서로 잠근다. 다른 저장이나 다른 일괄 되돌리기와 서로를 기다리지 않게 한다.
  perform 1 from public.pages as page where page.id = any (v_page_ids) order by page.id for update;

  for v_plan in
    select * from private.bulk_revert_plan(v_lookup.target_member_id, p_from_revision_id, v_page_ids) as plan
    order by plan.page_id
  loop
    page_id := v_plan.page_id;
    page_title := v_plan.page_title;
    if (v_expected ->> v_plan.page_id::text)::bigint is distinct from v_plan.current_revision_id
       or v_plan.status not in ('revert', 'delete') then
      outcome := 'skipped';
    elsif v_plan.status = 'revert' then
      select private.settle_redirect_body(v_plan.page_title, revision.body) into v_body
      from public.revisions as revision where revision.id = v_plan.restore_revision_id;
      perform private.write_revision(
        v_plan.page_id, v_admin_id, v_body,
        format('r%s 판으로 되돌림: 일괄 되돌리기', v_plan.restore_revision_id), 'revert', true
      );
      v_reverted := v_reverted + 1;
      outcome := 'reverted';
      -- 걷어 낸 판(돌아갈 판 뒤의 대상의 판)에 걸린 신고를 닫는다.
      perform private.close_reports(array(
        select author.revision_id
        from private.revision_authors as author
        join public.revisions as revision on revision.id = author.revision_id
        where author.member_id = v_lookup.target_member_id
          and revision.page_id = v_plan.page_id
          and revision.id >= coalesce(p_from_revision_id, 0)
          and revision.id > v_plan.restore_revision_id
      ));
    else
      -- `delete_page`와 같다. 현재 본문 그대로 삭제 판을 쓰고 숨긴다. 관리자가 복구할 수 있다.
      select revision.body into v_body
      from public.revisions as revision where revision.id = v_plan.current_revision_id;
      perform private.delete_page_as_admin(v_plan.page_id, v_admin_id, v_body, '일괄 되돌리기로 삭제');
      v_deleted := v_deleted + 1;
      outcome := 'deleted';
    end if;
    return next;
  end loop;

  if v_reverted + v_deleted > 0 then
    select * into v_source from private.revision_target(v_lookup.source_revision_id);
    perform private.log_admin_action(
      'bulk_revert', v_reason, v_source.page_title, v_lookup.source_revision_id, v_source.pseudonym,
      format('문서 %s개 되돌림, %s개 삭제', v_reverted, v_deleted)
    );
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."bulk_revert"(text, bigint, jsonb, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.count_open_reports()
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_admin();
  return (select count(distinct report.revision_id)::integer from private.reports as report where report.resolved_at is null);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."count_open_reports"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.delete_page (
  p_page_id bigint,
  p_reason  text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_admin_id bigint := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_page public.pages;
  v_body jsonb;
begin
  select * into v_page from public.pages where id = p_page_id for update;
  if v_page.id is null then
    raise exception 'page not found' using errcode = 'WK006';
  end if;
  if v_page.deleted_at is not null then
    raise exception 'already deleted' using errcode = 'WK011';
  end if;

  select body into v_body from public.revisions where id = v_page.current_revision_id;
  perform private.delete_page_as_admin(p_page_id, v_admin_id, coalesce(v_body, private.empty_doc()), v_reason);
  perform private.log_admin_action('delete_page', v_reason, v_page.title);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_open_reports()
  RETURNS TABLE (
    revision_id         bigint,
    page_id             bigint,
    page_title          text,
    pseudonym           text,
    parent_revision_id  bigint,
    revision_created_at timestamp with time zone,
    hidden_at           timestamp with time zone,
    is_current          boolean,
    page_deleted        boolean,
    first_reported_at   timestamp with time zone,
    reports             jsonb,
    dismissed_count     integer
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_admin();
  return query
  select
    revision.id, page.id, page.title, revision.author_pseudonym, revision.parent_revision_id,
    revision.created_at, revision.hidden_at, revision.id = page.current_revision_id,
    page.deleted_at is not null, grouped.first_reported_at, grouped.reports,
    (
      select count(*)::integer from private.reports as earlier
      where earlier.revision_id = grouped.revision_id and earlier.resolution = 'dismissed'
    )
  from (
    select
      report.revision_id,
      min(report.created_at) as first_reported_at,
      jsonb_agg(
        jsonb_build_object('category', report.category, 'note', report.note, 'created_at', report.created_at)
        order by report.created_at
      ) as reports
    from private.reports as report
    where report.resolved_at is null
    group by report.revision_id
  ) as grouped
  join public.revisions as revision on revision.id = grouped.revision_id
  join public.pages as page on page.id = revision.page_id
  -- 자르지 않는다. 머리띠의 수(`count_open_reports`)와 같은 판을 모두 보여야 닫을 수 있다.
  order by grouped.first_reported_at;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."list_open_reports"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.preview_bulk_revert (
  p_lookup_id        text,
  p_from_revision_id bigint DEFAULT NULL::bigint
)
  RETURNS TABLE (
    page_id             bigint,
    page_title          text,
    current_revision_id bigint,
    restore_revision_id bigint,
    edit_count          integer,
    kept_count          integer,
    has_move            boolean,
    move_leftover       boolean,
    status              text
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
  select * from private.bulk_revert_plan(v_target_id, p_from_revision_id)
  limit 500;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."preview_bulk_revert"(text, bigint) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.report_revision (
  p_revision_id bigint,
  p_category    text,
  p_note        text   DEFAULT ''::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_member_id bigint := private.require_editor();
  v_note text := btrim(coalesce(p_note, ''));
begin
  if p_category is null or p_category not in ('privacy', 'abuse', 'vandalism', 'other') then
    raise exception 'invalid category' using errcode = '22023';
  end if;
  if char_length(v_note) > 300 then
    raise exception 'note too long' using errcode = 'WK005', detail = 'note';
  end if;
  if p_category = 'other' and char_length(v_note) < 2 then
    raise exception 'a reason is required' using errcode = 'WK014';
  end if;
  if not exists (
    select 1
    from public.revisions as revision
    join public.pages as page on page.id = revision.page_id
    where revision.id = p_revision_id
      and revision.hidden_at is null
      and page.deleted_at is null
  ) then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;
  -- 기각된 판은 같은 사람이 다시 신고하지 않는다. 판의 내용은 바뀌지 않으므로 같은 판단이 나온다.
  if exists (
    select 1 from private.reports as report
    where report.revision_id = p_revision_id
      and report.reporter_member_id = v_member_id
      and report.resolution = 'dismissed'
  ) then
    raise exception 'already dismissed' using errcode = 'WK011';
  end if;
  -- 같은 사람의 신고를 한 줄로 세운다. 동시에 보낸 신고가 모두 세기를 통과해 한도를 넘지 않게 한다.
  perform 1 from private.members where id = v_member_id for update;
  if (
    select count(*) from private.reports as report
    where report.reporter_member_id = v_member_id
      and report.created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'too many reports' using errcode = 'WK019';
  end if;

  begin
    insert into private.reports (revision_id, reporter_member_id, category, note)
    values (p_revision_id, v_member_id, p_category, v_note);
  exception when unique_violation then
    raise exception 'already reported' using errcode = 'WK011';
  end;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."report_revision"(bigint, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.resolve_reports (
  p_revision_id bigint,
  p_resolution  text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_admin_id bigint := private.require_admin();
  v_count integer;
begin
  if p_resolution is null or p_resolution not in ('handled', 'dismissed') then
    raise exception 'invalid resolution' using errcode = '22023';
  end if;

  update private.reports
     set resolved_at = now(), resolved_by_member_id = v_admin_id, resolution = p_resolution
   where revision_id = p_revision_id and resolved_at is null;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'no open reports' using errcode = 'WK011';
  end if;
  return v_count;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."resolve_reports"(bigint, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.revert_and_hide_revision (
  p_revision_id bigint,
  p_reason      text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_admin_id bigint := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_page public.pages;
  v_restore public.revisions;
begin
  select page.* into v_page
  from public.revisions as revision
  join public.pages as page on page.id = revision.page_id
  where revision.id = p_revision_id
  for update of page;
  if v_page.id is null then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;

  if v_page.current_revision_id = p_revision_id then
    select * into v_restore
    from public.revisions as revision
    where revision.page_id = v_page.id and revision.id < p_revision_id and revision.hidden_at is null
    order by revision.id desc
    limit 1;
    if v_restore.id is null then
      perform private.delete_page_as_admin(v_page.id, v_admin_id, private.empty_doc(), v_reason);
      perform private.log_admin_action('delete_page', v_reason, v_page.title);
    else
      perform private.write_revision(
        v_page.id, v_admin_id, private.settle_redirect_body(v_page.title, v_restore.body),
        format('r%s 판으로 되돌림', v_restore.id), 'revert', true
      );
    end if;
  end if;

  perform public.set_revision_hidden(p_revision_id, true, v_reason);
end;
$function$;

REVOKE ALL ON FUNCTION "public"."revert_and_hide_revision"(bigint, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_revision_hidden (
  p_revision_id bigint,
  p_hidden      boolean,
  p_reason      text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_reason text;
  v_revision public.revisions;
  v_page public.pages;
begin
  perform private.require_admin();
  v_reason := private.require_reason(p_reason);

  select * into v_revision from public.revisions where id = p_revision_id for update;
  if v_revision.id is null then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;
  select * into v_page from public.pages where id = v_revision.page_id;

  if (v_revision.hidden_at is not null) = p_hidden then
    raise exception 'already in that state' using errcode = 'WK011';
  end if;
  if p_hidden and v_page.current_revision_id = p_revision_id then
    raise exception 'cannot hide the current revision' using errcode = 'WK012';
  end if;

  update public.revisions
     set hidden_at = case when p_hidden then now() end
   where id = p_revision_id;
  perform private.log_admin_action(
    case when p_hidden then 'hide_revision' else 'unhide_revision' end,
    v_reason, v_page.title, p_revision_id, v_revision.author_pseudonym
  );
  if p_hidden then
    perform private.close_reports(array[p_revision_id]);
  end if;
end;
$function$;

ALTER TABLE "private"."reports"
  ADD CONSTRAINT "reports_reporter_member_id_fkey" FOREIGN KEY (reporter_member_id) REFERENCES private.members(id) ON DELETE SET NULL;

ALTER TABLE "private"."reports"
  ADD CONSTRAINT "reports_resolved_by_member_id_fkey" FOREIGN KEY (resolved_by_member_id) REFERENCES private.members(id) ON DELETE SET NULL;

ALTER TABLE "private"."reports"
  ADD CONSTRAINT "reports_revision_id_fkey" FOREIGN KEY (revision_id) REFERENCES public.revisions(id) ON DELETE CASCADE;

ALTER TABLE "public"."admin_log"
  ADD CONSTRAINT "admin_log_action"
    CHECK
    ((action = ANY (ARRAY['ban'::text, 'lift_ban'::text, 'grant_admin'::text, 'revoke_admin'::text, 'protect'::text, 'unprotect'::text, 'delete_page'::text, 'restore_page'::text,
    'hide_revision'::text, 'unhide_revision'::text, 'view_author_edits'::text, 'change_ban'::text, 'bulk_revert'::text])));

CREATE UNIQUE INDEX reports_open_unique ON private.reports USING btree (revision_id, reporter_member_id)
  WHERE (resolved_at IS NULL);

CREATE INDEX reports_reporter_idx ON private.reports USING btree (reporter_member_id, created_at DESC);

CREATE INDEX reports_revision_idx ON private.reports USING btree (revision_id);

REVOKE ALL ON FUNCTION "private"."bulk_revert_plan"(bigint, bigint, bigint[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."close_reports"(bigint[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "private"."delete_page_as_admin"(bigint, bigint, jsonb, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."bulk_revert"(text, bigint, jsonb, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."bulk_revert"(text, bigint, jsonb, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."bulk_revert"(text, bigint, jsonb, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."bulk_revert"(text, bigint, jsonb, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."count_open_reports"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."count_open_reports"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_open_reports"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_open_reports"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_open_reports"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_open_reports"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_open_reports"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_open_reports"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."preview_bulk_revert"(text, bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."preview_bulk_revert"(text, bigint) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."preview_bulk_revert"(text, bigint) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."preview_bulk_revert"(text, bigint) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."report_revision"(bigint, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."report_revision"(bigint, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."report_revision"(bigint, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."report_revision"(bigint, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."resolve_reports"(bigint, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."resolve_reports"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_reports"(bigint, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_reports"(bigint, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."revert_and_hide_revision"(bigint, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."revert_and_hide_revision"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."revert_and_hide_revision"(bigint, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."revert_and_hide_revision"(bigint, text) TO "service_role";
