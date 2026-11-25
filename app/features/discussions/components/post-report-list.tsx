import { useState } from "react";
import { Link } from "react-router";

import { resolvePostReports, setPostHidden } from "../data/mutations";
import { describeDiscussionError } from "../model/errors";
import { topicHref } from "../model/rules";
import type { OpenPostReport } from "../model/types";
import { PostText } from "./post-text";
import { notifyOpenReportsChanged, ReasonDialog } from "~/features/admin";
import { reportCategoryLabel } from "~/features/reports";
import { formatDateTime } from "~/shared/lib/time";
import { isWikiError } from "~/shared/supabase/errors";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";

const STATE_LABEL = { hidden: "숨김", withdrawn: "거둔 글" } as const;

/**
 * 처리되지 않은 토론 글 신고를 글별로 보인다(관리자 전용). 글 본문을 바로 보이고, [글 숨기기]로
 * 숨기면 신고도 닫힌다. 다른 조치를 했거나 조치할 일이 없으면 [처리 완료]이나 [기각]으로 닫는다.
 */
export function PostReportList({
  reports,
  onChanged,
}: {
  reports: OpenPostReport[];
  /** 조치하거나 닫은 뒤 목록을 다시 읽는다. */
  onChanged: () => void;
}) {
  if (reports.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        처리할 토론 글 신고가 없습니다.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-md border text-sm">
      {reports.map((report) => (
        <PostReportItem
          key={report.postId}
          report={report}
          onChanged={onChanged}
        />
      ))}
    </ul>
  );
}

function PostReportItem({
  report,
  onChanged,
}: {
  report: OpenPostReport;
  onChanged: () => void;
}) {
  const [hiding, setHiding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(resolution: "handled" | "dismissed") {
    setPending(true);
    setError(null);
    try {
      await resolvePostReports(report.postId, resolution);
      onChanged();
    } catch (caught) {
      // 다른 관리자가 먼저 닫았다(WK011). 목록과 머리띠의 수에서 빼면 된다.
      if (isWikiError(caught, "WK011")) {
        notifyOpenReportsChanged();
        onChanged();
      } else setError(describeDiscussionError(caught));
    } finally {
      setPending(false);
    }
  }

  const title = `${report.pageTitle} · ${report.discussionTitle}`;
  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* 거둔 토론은 관리자도 열 수 없다. */}
        {report.discussionWithdrawn ? (
          <span className="font-medium">{title}</span>
        ) : (
          <Link
            to={`${topicHref(report.discussionId)}#post-${report.postId}`}
            className="font-medium text-primary hover:underline"
          >
            {title}
          </Link>
        )}
        <span className="text-muted-foreground">{report.authorName}</span>
        <span className="text-muted-foreground">
          {formatDateTime(report.postCreatedAt)}
        </span>
        {report.kind === "open" ? (
          <Badge variant="secondary">첫 글</Badge>
        ) : null}
        {report.state !== "visible" ? (
          <Badge variant="outline">{STATE_LABEL[report.state]}</Badge>
        ) : null}
        {report.discussionWithdrawn ? (
          <Badge variant="outline">거둔 토론</Badge>
        ) : report.discussionDeleted ? (
          <Badge variant="outline">지운 토론</Badge>
        ) : null}
        {report.dismissedCount > 0 ? (
          <Badge variant="outline">이전 기각 {report.dismissedCount}건</Badge>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          {report.state === "hidden" ? null : (
            <Button
              size="xs"
              variant="destructive"
              disabled={pending}
              onClick={() => setHiding(true)}
            >
              글 숨기기
            </Button>
          )}
          <Button
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={() => void resolve("handled")}
          >
            처리 완료
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

      <div className="mt-1 border-l-2 pl-3 text-muted-foreground">
        <PostText text={report.body} />
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

      <ReasonDialog
        open={hiding}
        onOpenChange={setHiding}
        title="글 숨기기"
        description={`${report.authorName}의 글을 숨깁니다. 회원에게는 "관리자가 숨긴 글"로 보이고, 이 글의 신고는 처리 완료로 닫힙니다.`}
        confirmLabel="숨기기"
        destructive
        onConfirm={(reason) => setPostHidden(report.postId, true, reason)}
        onDone={onChanged}
      />
    </li>
  );
}
