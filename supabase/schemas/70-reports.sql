-- 선언적 스키마 정본. 이 파일을 먼저 고치고 `pnpm db:diff <이름>`으로 migration 초안을 만든 뒤 검토한다.
--
-- 신고. 회원이 관리자에게만 판 하나나 토론 글 하나를 알린다(개인정보, 비방, 훼손). 내용은 누구나 고칠
-- 수 있으므로, 신고는 회원이 직접 할 수 없는 일(판·글 숨기기, 차단, 보호)을 부탁하는 길이다. 토론 글
-- 신고 RPC는 `80-discussions.sql`에 있다.

SET check_function_bodies = false;

-- 신고 한 건. 신고자는 중복과 횟수 제한에만 쓰고, 어떤 RPC도 돌려주지 않는다(관리자에게도). 공개
-- 기록에는 남기지 않는다. 대상은 판(`revision_id`)이나 토론 글(`post_id`) 하나다. 대상이 지워지면 신고도
-- 지운다. `post_id`의 외래 키는 토론 글 테이블 뒤(`80-discussions.sql` 끝)에 있다.
CREATE TABLE "private"."reports" (
  "id"                    bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "revision_id"           bigint,
  "post_id"               bigint,
  "reporter_member_id"    bigint,
  "category"              text                     NOT NULL,
  -- 신고자가 덧붙인 말. 0~300자, `other`면 2자 이상.
  "note"                  text                     NOT NULL DEFAULT ''::text,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at"           timestamp with time zone,
  "resolved_by_member_id" bigint,
  "resolution"            text,
  CONSTRAINT "reports_target" CHECK ((num_nonnulls(revision_id, post_id) = 1)),
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

-- 판별 신고. 기각 수(`list_open_reports`), 기각 뒤 재신고 검사(`report_revision`), 판 삭제의 cascade가
-- 쓴다. 아래 색인은 처리되지 않은 신고만 담아서 이것들에 쓰지 못한다.
CREATE INDEX reports_revision_idx ON private.reports USING btree (revision_id);

-- 같은 판에 대한 내 신고가 처리되기 전에는 다시 신고하지 않는다. 관리자 목록과 머리띠의 수도 이
-- 색인으로 처리되지 않은 신고를 읽는다.
CREATE UNIQUE INDEX reports_open_unique ON private.reports USING btree (revision_id, reporter_member_id)
  WHERE (resolved_at IS NULL);

-- 토론 글 신고. 위의 두 색인과 같은 일을 토론 글에 한다.
CREATE INDEX reports_post_idx ON private.reports USING btree (post_id)
  WHERE (post_id IS NOT NULL);

CREATE UNIQUE INDEX reports_post_open_unique ON private.reports USING btree (post_id, reporter_member_id)
  WHERE ((resolved_at IS NULL) AND (post_id IS NOT NULL));

-- 신고 종류와 덧붙임을 검사하고 다듬은 덧붙임을 돌려준다. 판 신고와 토론 글 신고가 함께 쓴다.
CREATE OR REPLACE FUNCTION private.check_report_note (
  p_category text,
  p_note     text
)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
declare
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
  return v_note;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."check_report_note"(text, text) FROM PUBLIC;

-- 한 사람의 신고는 판과 토론 글을 합쳐 1시간에 10건까지다. 같은 사람의 신고를 한 줄로 세운다. 동시에
-- 보낸 신고가 모두 세기를 통과해 한도를 넘지 않게 한다.
CREATE OR REPLACE FUNCTION private.check_report_rate (
  p_member_id bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform 1 from private.members where id = p_member_id for update;
  if (
    select count(*) from private.reports as report
    where report.reporter_member_id = p_member_id
      and report.created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'too many reports' using errcode = 'WK019';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."check_report_rate"(bigint) FROM PUBLIC;

-- 판들과 토론 글들에 걸린 처리되지 않은 신고를 닫고 닫은 건수를 돌려준다. 처리한 관리자는 지금
-- 로그인한 관리자다. 작성자가 글을 거두어 닫히면 처리자가 없다(NULL). 대상이 보이지 않게 될 때(아래
-- 트리거)와 일괄 되돌리기가 판을 걷어 낼 때는 `handled`로 닫는다. 관리자의 신고 닫기
-- (`resolve_reports`, `resolve_post_reports`)는 `handled`나 `dismissed`로 닫는다.
CREATE OR REPLACE FUNCTION private.close_reports (
  p_revision_ids bigint[],
  p_post_ids     bigint[] DEFAULT '{}'::bigint[],
  p_resolution   text     DEFAULT 'handled'::text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_count integer;
begin
  if p_resolution is null or p_resolution not in ('handled', 'dismissed') then
    raise exception 'invalid resolution' using errcode = '22023';
  end if;
  update private.reports
     set resolved_at = now(),
         resolved_by_member_id = case when private.is_admin() then private.current_member_id() end,
         resolution = p_resolution
   where (revision_id = any (p_revision_ids) or post_id = any (p_post_ids)) and resolved_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."close_reports"(bigint[], bigint[], text) FROM PUBLIC;

-- 열린 신고의 대상은 회원에게 보인다. 대상이 보이지 않게 되면 트리거가 신고를 `handled`로 닫는다.
-- 그래서 숨기기·삭제 RPC는 신고를 몰라도 된다. 되살려도 신고는 다시 열지 않는다. 토론 글의 트리거는
-- `80-discussions.sql`에 있다.

-- 판을 숨기면 그 판의 신고를 닫는다.
CREATE OR REPLACE FUNCTION private.close_hidden_revision_reports()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.close_reports(array[new.id]);
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."close_hidden_revision_reports"() FROM PUBLIC;

CREATE TRIGGER close_reports_on_hide AFTER UPDATE OF hidden_at ON public.revisions FOR EACH ROW WHEN (((old.hidden_at IS NULL) AND (new.hidden_at IS NOT NULL))) EXECUTE FUNCTION private.close_hidden_revision_reports();

-- 문서를 삭제하면 그 문서의 모든 판의 신고를 닫는다. 삭제된 문서의 판은 회원에게 보이지 않는다.
CREATE OR REPLACE FUNCTION private.close_deleted_page_revision_reports()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.close_reports(array(
    select revision.id from public.revisions as revision where revision.page_id = new.id
  ));
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."close_deleted_page_revision_reports"() FROM PUBLIC;

CREATE TRIGGER close_revision_reports_on_delete AFTER UPDATE OF deleted_at ON public.pages FOR EACH ROW WHEN (((old.deleted_at IS NULL) AND (new.deleted_at IS NOT NULL))) EXECUTE FUNCTION private.close_deleted_page_revision_reports();

-- 처리되지 않은 신고가 걸린 대상(판과 토론 글) 수(관리자 전용).
CREATE OR REPLACE FUNCTION public.count_open_reports()
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_admin();
  return (
    select (count(distinct report.revision_id) + count(distinct report.post_id))::integer
    from private.reports as report where report.resolved_at is null
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."count_open_reports"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."count_open_reports"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."count_open_reports"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_open_reports"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."count_open_reports"() FROM PUBLIC, "anon";

-- 처리되지 않은 신고를 판별로 묶는다(관리자 전용). 신고자는 돌려주지 않는다. 오래된 신고부터. 판이
-- 지워지면 신고도 지워진다(on delete cascade). 토론 글 신고는 `list_open_post_reports`가 준다.
-- `dismissed_count`는 같은 판에서 전에 기각한 신고 수다. 관리자가 앞의 판단을 참고한다.
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
    where report.resolved_at is null and report.revision_id is not null
    group by report.revision_id
  ) as grouped
  join public.revisions as revision on revision.id = grouped.revision_id
  join public.pages as page on page.id = revision.page_id
  -- 자르지 않는다. 머리띠의 수(`count_open_reports`)에 든 판을 모두 보여야 닫을 수 있다.
  order by grouped.first_reported_at;
end;
$function$;

GRANT EXECUTE ON FUNCTION "public"."list_open_reports"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."list_open_reports"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_open_reports"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_open_reports"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_open_reports"() FROM PUBLIC, "anon";

-- 신고 한 건을 넣는다. 판 신고와 글 신고가 같이 쓴다. 대상(`p_revision_id`, `p_post_id` 중 하나)은 부르는
-- 쪽이 확인한다. 기각된 대상은 같은 사람이 다시 신고하지 않는다. 판과 글은 고칠 수 없으므로 같은 판단이
-- 나온다.
CREATE OR REPLACE FUNCTION private.insert_report (
  p_member_id   bigint,
  p_revision_id bigint,
  p_post_id     bigint,
  p_category    text,
  p_note        text
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if exists (
    select 1 from private.reports as report
    where (report.revision_id = p_revision_id or report.post_id = p_post_id)
      and report.reporter_member_id = p_member_id
      and report.resolution = 'dismissed'
  ) then
    raise exception 'already dismissed' using errcode = 'WK011';
  end if;
  perform private.check_report_rate(p_member_id);

  begin
    insert into private.reports (revision_id, post_id, reporter_member_id, category, note)
    values (p_revision_id, p_post_id, p_member_id, p_category, p_note);
  exception when unique_violation then
    raise exception 'already reported' using errcode = 'WK011';
  end;
end;
$function$;

REVOKE ALL ON FUNCTION "private"."insert_report"(bigint, bigint, bigint, text, text) FROM PUBLIC;

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
  v_note text := private.check_report_note(p_category, p_note);
begin
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
  perform private.insert_report(v_member_id, p_revision_id, null, p_category, v_note);
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
  v_count integer;
begin
  perform private.require_admin();
  v_count := private.close_reports(array[p_revision_id], p_resolution => p_resolution);
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
