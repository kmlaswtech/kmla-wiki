import type { ReactNode } from "react";
import { Link } from "react-router";

import { TextChange } from "./text-change";
import { revisionKindLabel } from "../model/errors";
import type { RevisionSummary } from "../model/types";
import { pageHref } from "~/features/markup";
import { RelativeTime } from "~/shared/components/relative-time";
import { Badge } from "~/shared/ui/badge";
import { cn } from "~/shared/lib/utils";

interface RevisionListProps<Row extends RevisionSummary> {
  revisions: readonly Row[];
  /** 그 판이 속한 문서 제목. 판 기록은 한 문서, 최근 변경은 줄마다 다르다. */
  pageTitle: (revision: Row) => string;
  /** 문서 제목을 줄에 보여 줄지(최근 변경). */
  showPage?: boolean;
  /** 이 문서에서의 내 가명. 내가 쓴 판에 "나"를 붙인다. */
  myPseudonym?: string | null;
  /** 줄 끝에 붙일 버튼들(되돌리기, 관리 메뉴). */
  actions?: (revision: Row) => ReactNode;
  /** 줄 맨 앞에 붙일 것(판 기록의 비교할 판 고르기). */
  leading?: (revision: Row) => ReactNode;
  /** 줄 아래 전체 폭에 펼칠 것(관리자의 "다른 편집 보기"에서 바로 전 판과의 비교). */
  detail?: (revision: Row) => ReactNode;
}

/** 판 목록 한 벌. 판 기록, 최근 변경, 관리자의 "다른 편집 보기"가 같이 쓴다. */
export function RevisionList<Row extends RevisionSummary>({
  revisions,
  pageTitle,
  showPage = false,
  myPseudonym,
  actions,
  leading,
  detail,
}: RevisionListProps<Row>) {
  if (revisions.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground">기록이 없습니다.</p>
    );
  }

  return (
    <ul className="divide-y text-sm">
      {revisions.map((revision) => {
        const title = pageTitle(revision);
        const extra = detail?.(revision);
        const kind = revisionKindLabel(revision.kind);
        return (
          <li
            key={revision.id}
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 py-2",
              revision.hiddenAt && "opacity-60",
            )}
          >
            {leading?.(revision)}
            <span className="shrink-0 text-muted-foreground sm:w-20">
              <RelativeTime value={revision.createdAt} />
            </span>

            {showPage ? (
              <Link
                to={pageHref(title)}
                className="font-medium text-primary hover:underline"
              >
                {title}
              </Link>
            ) : (
              <Link
                to={`${pageHref(title)}?rev=${revision.id}`}
                className="text-primary tabular-nums hover:underline"
              >
                r{revision.id}
              </Link>
            )}

            <TextChange revision={revision} />

            <span className="font-mono text-xs text-muted-foreground">
              {revision.authorPseudonym}
              {myPseudonym && revision.authorPseudonym === myPseudonym ? (
                <Badge variant="secondary" className="ml-1.5 font-sans">
                  나
                </Badge>
              ) : null}
            </span>

            {kind ? <Badge variant="outline">{kind}</Badge> : null}
            {revision.hiddenAt ? <Badge variant="outline">숨김</Badge> : null}

            {/* 폰에서는 요약을 둘째 줄 전체로 보낸다. 그대로 두면 시간 칸 밑으로 들어가 시간의 일부처럼 읽힌다. */}
            <span className="min-w-0 flex-1 basis-40 break-words text-muted-foreground max-sm:order-last max-sm:basis-full">
              {revision.summary}
            </span>

            <span className="flex shrink-0 items-center gap-1">
              {revision.parentRevisionId !== null ? (
                <Link
                  to={`${pageHref(title, "diff")}?from=${revision.parentRevisionId}&to=${revision.id}`}
                  className="rounded px-1.5 py-0.5 text-primary hover:bg-muted"
                >
                  비교
                </Link>
              ) : null}
              {actions?.(revision)}
            </span>
            {extra ? (
              // 줄 맨 끝(폰에서 요약 다음) 전체 폭.
              <div className="order-last basis-full pt-1">{extra}</div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
