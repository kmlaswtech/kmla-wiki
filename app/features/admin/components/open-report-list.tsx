import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { notifyOpenReportsChanged, resolveReports } from "../data/mutations";
import type { OpenReport } from "../data/queries";
import { describeAdminError } from "../model/log";
import { HideRevisionDialog, hideLabel } from "./hide-revision-dialog";
import { InlineRevisionDiff } from "./inline-revision-diff";
import { RevisionAdminMenu } from "./revision-admin-menu";
import { pageHref } from "~/features/markup";
import { reportCategoryLabel } from "~/features/reports";
import { formatDateTime } from "~/shared/lib/time";
import { isWikiError } from "~/shared/supabase/errors";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";

/**
 * 처리되지 않은 신고를 판별로 보인다(관리자 전용). 판을 펼쳐 바로 전 판과 비교하고, 판 기록과 같은
 * 관리 메뉴로 조치한다. 숨기기(현재 판이면 되돌리고 숨기기)는 단추로 바로 보이고, 숨기면 신고도
 * 닫힌다. 다른 조치를 했거나 조치할 일이 없으면 [처리함]이나 [기각]으로 닫는다. 신고자는 오지 않는다.
 */
export function OpenReportList({
  reports,
  onChanged,
}: {
  reports: OpenReport[];
  /** 조치하거나 닫은 뒤 목록을 다시 읽는다. */
  onChanged: () => void;
}) {
  if (reports.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">처리할 신고가 없습니다.</p>
    );
  }
  return (
    <ul className="divide-y rounded-md border text-sm">
      {reports.map((report) => (
        <OpenReportItem
          key={report.revisionId}
          report={report}
          onChanged={onChanged}
        />
      ))}
    </ul>
  );
}

function OpenReportItem({
  report,
  onChanged,
}: {
  report: OpenReport;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(resolution: "handled" | "dismissed") {
    setPending(true);
    setError(null);
    try {
      await resolveReports(report.revisionId, resolution);
      onChanged();
    } catch (caught) {
      // 다른 관리자가 먼저 닫았다(WK011). 목록과 머리띠의 수에서 빼면 된다.
      if (isWikiError(caught, "WK011")) {
        notifyOpenReportsChanged();
        onChanged();
      } else setError(describeAdminError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          to={pageHref(report.pageTitle, "history")}
          className="font-medium text-primary hover:underline"
        >
          {report.pageTitle}
        </Link>
        <span>r{report.revisionId}</span>
        <span className="text-muted-foreground">{report.authorPseudonym}</span>
        <span className="text-muted-foreground">
          {formatDateTime(report.revisionCreatedAt)}
        </span>
        {report.isCurrent ? <Badge variant="secondary">현재 판</Badge> : null}
        {report.hiddenAt ? <Badge variant="outline">숨김</Badge> : null}
        {report.pageDeleted ? (
          <Badge variant="outline">삭제된 문서</Badge>
        ) : null}
        {report.dismissedCount > 0 ? (
          <Badge variant="outline">
            전에 기각한 신고 {report.dismissedCount}건
          </Badge>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-expanded={open}
            aria-label={
              open
                ? `r${report.revisionId} 비교 접기`
                : `r${report.revisionId} 바로 전 판과 비교 펼치기`
            }
            onClick={() => setOpen(!open)}
          >
            <ChevronDown
              className={open ? "rotate-180 transition" : "transition"}
            />
          </Button>
          <RevisionAdminMenu
            revision={{
              id: report.revisionId,
              authorPseudonym: report.authorPseudonym,
              hiddenAt: report.hiddenAt,
            }}
            pageTitle={report.pageTitle}
            isCurrent={report.isCurrent}
            onDone={onChanged}
          />
          {report.hiddenAt ? null : (
            <Button
              size="xs"
              variant="destructive"
              disabled={pending}
              onClick={() => setHiding(true)}
            >
              {hideLabel(report, report.isCurrent)}
            </Button>
          )}
          <Button
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={() => void resolve("handled")}
          >
            처리함
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => void resolve("dismissed")}
          >
            기각
          </Button>
        </span>
      </div>

      <ul className="mt-1 space-y-0.5">
        {report.reports.map((entry, index) => (
          <li key={index} className="text-muted-foreground">
            <span className="font-medium text-foreground">
              {reportCategoryLabel(entry.category)}
            </span>
            {entry.note ? ` · ${entry.note}` : null}
            <span className="text-xs">
              {" "}
              · {formatDateTime(entry.createdAt)}
            </span>
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="mt-1 text-destructive">
          {error}
        </p>
      ) : null}

      <HideRevisionDialog
        open={hiding}
        onOpenChange={setHiding}
        revision={{ id: report.revisionId, hiddenAt: report.hiddenAt }}
        isCurrent={report.isCurrent}
        onDone={onChanged}
      />

      {open ? (
        <div className="pt-1">
          <InlineRevisionDiff
            pageId={report.pageId}
            beforeId={report.parentRevisionId}
            afterId={report.revisionId}
          />
        </div>
      ) : null}
    </li>
  );
}
