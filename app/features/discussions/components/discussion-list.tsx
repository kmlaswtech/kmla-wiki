import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { topicHref } from "../model/rules";
import type { DiscussionSummary } from "../model/types";
import { pageHref } from "~/features/markup";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";

export type DiscussionFilter = "all" | "open" | "closed";

const FILTERS: { value: DiscussionFilter; label: string }[] = [
  { value: "all", label: "모두" },
  { value: "open", label: "열린 토론" },
  { value: "closed", label: "닫힌 토론" },
];

const EMPTY: Record<DiscussionFilter, string> = {
  all: "토론이 없습니다.",
  open: "열린 토론이 없습니다.",
  closed: "닫힌 토론이 없습니다.",
};

function matches(row: DiscussionSummary, filter: DiscussionFilter): boolean {
  if (filter === "all") return true;
  return row.isOpen === (filter === "open");
}

/**
 * 토론 목록(서버가 준 최근 활동순)과 모두·열린·닫힌 거르개. 줄에 `pageTitle`이 있으면 문서 이름도
 * 보인다(최근 토론).
 */
export function DiscussionList({
  discussions,
  revisionHref,
  defaultFilter = "open",
}: {
  discussions: readonly DiscussionSummary[];
  /** 붙인 판을 여는 주소. 없으면 판을 보이지 않는다. */
  revisionHref?: (revisionId: number) => string;
  defaultFilter?: DiscussionFilter;
}) {
  const [filter, setFilter] = useState(defaultFilter);

  const rows = discussions.filter((row) => matches(row, filter));

  return (
    <div>
      <div
        role="group"
        aria-label="보일 토론"
        className="mb-2 inline-flex rounded-md border p-0.5 text-sm"
      >
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "rounded-sm px-3 py-1 text-muted-foreground hover:text-foreground coarse:py-1.5",
              filter === value && "bg-muted font-medium text-foreground",
            )}
          >
            {label}{" "}
            <span className="tabular-nums">
              {discussions.filter((row) => matches(row, value)).length}
            </span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          {EMPTY[filter]}
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((row) => (
            <li
              key={row.id}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5",
                row.deleted && "opacity-60",
              )}
            >
              <Badge variant={row.isOpen ? "default" : "outline"}>
                {row.isOpen ? "열림" : "닫힘"}
              </Badge>
              <Link
                to={topicHref(row.id)}
                className="min-w-0 flex-1 basis-48 font-medium break-words text-primary hover:underline"
              >
                {row.title}
              </Link>
              {row.deleted ? <Badge variant="outline">지움</Badge> : null}
              <span className="flex shrink-0 flex-wrap items-center gap-x-3 text-muted-foreground">
                {row.pageTitle !== undefined ? (
                  <Link
                    to={pageHref(row.pageTitle)}
                    className="break-words hover:underline"
                  >
                    {row.pageTitle}
                  </Link>
                ) : null}
                {row.revisionId !== null && revisionHref ? (
                  <Link
                    to={revisionHref(row.revisionId)}
                    className="tabular-nums hover:underline"
                  >
                    r{row.revisionId}
                  </Link>
                ) : null}
                <span className="font-mono text-xs">{row.openerName}</span>
                <span className="flex items-center gap-1 tabular-nums">
                  <MessageSquare className="size-3.5" aria-label="글 수" />
                  {row.postCount}
                </span>
                <RelativeTime value={row.lastPostAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
