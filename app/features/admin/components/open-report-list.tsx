import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { resolveReports } from "../data/mutations";
import type { OpenReport } from "../data/queries";
import { describeAdminError } from "../model/log";
import { InlineRevisionDiff } from "./inline-revision-diff";
import { RevisionAdminMenu } from "./revision-admin-menu";
import { notifyOpenReportsChanged } from "./use-open-report-count";
import { pageHref } from "~/features/markup";
import { reportCategoryLabel } from "~/features/reports";
import { formatDateTime } from "~/shared/lib/time";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";

/**
 * 처리되지 않은 신고를 판별로 보인다(관리자 전용). 판을 펼쳐 바로 전 판과 비교하고, 판 기록과 같은
 * 관리 메뉴로 조치한 뒤 신고를 닫는다. 신고자는 오지 않는다.
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(resolution: "handled" | "dismissed") {
    setPending(true);
    setError(null);
    try {
      await resolveReports(report.revisionId, resolution);
      notifyOpenReportsChanged();
      onChanged();
    } catch (caught) {
      setError(describeAdminError(caught));
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
