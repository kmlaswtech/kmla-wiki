-- 선언적 스키마 정본. 이 파일을 먼저 고치고 `pnpm db:diff <이름>`으로 migration 초안을 만든 뒤 검토한다.
--
-- 신고. 회원이 관리자에게만 판 하나를 알린다(개인정보, 비방, 훼손). 내용은 누구나 고칠 수 있으므로,
-- 신고는 회원이 직접 할 수 없는 일(판 숨기기, 차단, 보호)을 부탁하는 길이다.

SET check_function_bodies = false;

-- 신고 한 건. 신고자는 중복과 횟수 제한에만 쓰고, 어떤 RPC도 돌려주지 않는다(관리자에게도). 공개
-- 기록에는 남기지 않는다. 판이 지워지면 신고도 지운다.
CREATE TABLE "private"."reports" (
  "id"                    bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "revision_id"           bigint                   NOT NULL,
  "reporter_member_id"    bigint,
  "category"              text                     NOT NULL,
  -- 신고자가 덧붙인 말. 0~300자, `other`면 2자 이상.
  "note"                  text                     NOT NULL DEFAULT ''::text,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at"           timestamp with time zone,
  "resolved_by_member_id" bigint,
  "resolution"            text,
  CONSTRAINT "reports_category" CHECK ((category = ANY (ARRAY['privacy'::text, 'abuse'::text, 'vandalism'::text, 'other'::text]))),
  CONSTRAINT "reports_resolution" CHECK ((((resolved_at IS NULL) AND (resolution IS NULL)) OR ((resolved_at IS NOT NULL) AND (resolution = ANY (ARRAY['handled'::text, 'dismissed'::text]))))),
  CONSTRAINT "reports_pkey" PRIMARY KEY (id),
  CONSTRAINT "reports_reporter_member_id_fkey" FOREIGN KEY (reporter_member_id) REFERENCES private.members(id) ON DELETE SET NULL,
  CONSTRAINT "reports_resolved_by_member_id_fkey" FOREIGN KEY (resolved_by_member_id) REFERENCES private.members(id) ON DELETE SET NULL,
  CONSTRAINT "reports_revision_id_fkey" FOREIGN KEY (revision_id) REFERENCES public.revisions(id) ON DELETE CASCADE
);

ALTER TABLE "private"."reports"
  ENABLE ROW LEVEL SECURITY;

-- 한 사람의 1시간 신고 수.
CREATE INDEX reports_reporter_idx ON private.reports USING btree (reporter_member_id, created_at DESC);

-- 같은 판에 대한 내 신고가 처리되기 전에는 다시 신고하지 않는다. 관리자 목록과 머리띠의 수도 이
-- 색인으로 처리되지 않은 신고를 읽는다.
CREATE UNIQUE INDEX reports_open_unique ON private.reports USING btree (revision_id, reporter_member_id)
  WHERE (resolved_at IS NULL);

-- 처리되지 않은 신고가 걸린 판 수(관리자 전용).
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

GRANT EXECUTE ON FUNCTION "public"."count_open_reports"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."count_open_reports"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."count_open_reports"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_open_reports"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."count_open_reports"() FROM PUBLIC, "anon";

-- 처리되지 않은 신고를 판별로 묶는다(관리자 전용). 신고자는 돌려주지 않는다. 오래된 신고부터. 판이
-- 지워지면 신고도 지워지므로(on delete cascade) 판 수는 `count_open_reports`와 같다.
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
    reports             jsonb
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
    page.deleted_at is not null, grouped.first_reported_at, grouped.reports
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

GRANT EXECUTE ON FUNCTION "public"."list_open_reports"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_open_reports"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_open_reports"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_open_reports"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_open_reports"() FROM PUBLIC, "anon";

-- 판 하나를 신고한다. 회원 확인을 마치고 차단되지 않은 회원만 한다. 숨긴 판과 삭제된 문서의 판은
-- 보이지 않으므로 신고할 수 없다(없는 판과 같은 오류).
CREATE OR REPLACE FUNCTION public.report_revision (
  p_revision_id bigint,
  p_category    text,
  p_note        text DEFAULT ''::text
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

GRANT EXECUTE ON FUNCTION "public"."report_revision"(bigint, text, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."report_revision"(bigint, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."report_revision"(bigint, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."report_revision"(bigint, text, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."report_revision"(bigint, text, text) FROM PUBLIC, "anon";

-- 판 하나에 걸린 처리되지 않은 신고를 모두 닫는다(관리자 전용). `handled`는 조치함, `dismissed`는
-- 기각. 결과와 처리한 관리자는 비공개로 남는다. 닫은 건수를 돌려준다.
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

GRANT EXECUTE ON FUNCTION "public"."resolve_reports"(bigint, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."resolve_reports"(bigint, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_reports"(bigint, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."resolve_reports"(bigint, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."resolve_reports"(bigint, text) FROM PUBLIC, "anon";
