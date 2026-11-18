import { Link } from "react-router";

import { latestChangePerPage } from "../model/recent";
import type { RecentChange } from "../model/types";
import { pageHref } from "~/features/markup";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";

const PANEL_COUNT = 10;

/**
 * 화면 곁(넓은 화면) 또는 맨 아래(좁은 화면)의 최근 변경 목록. 문서마다 가장 새 판 하나만 보인다.
 *
 * `changes`가 아직 없으면(처음 읽는 중) 자리만 잡아 둔다.
 */
export function RecentChangesPanel({
  changes,
  className,
}: {
  changes: readonly RecentChange[] | undefined;
  className?: string;
}) {
  const rows = changes ? latestChangePerPage(changes, PANEL_COUNT) : null;

  return (
    <section aria-labelledby="recent-panel-title" className={className}>
      <div className="mb-1 flex items-baseline justify-between border-b pb-1.5">
        <h2 id="recent-panel-title" className="font-bold">
          최근 변경
        </h2>
        <Link to="/recent" className="text-sm text-primary hover:underline">
          더 보기
        </Link>
      </div>
      {rows === null ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          불러오는 중…
        </p>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          기록이 없습니다.
        </p>
      ) : (
        <ul className="text-sm">
          {rows.map((change) => (
            <li
              key={change.id}
              className={cn(
                "flex items-baseline gap-2 py-1 coarse:py-2",
                change.hiddenAt && "opacity-60",
              )}
            >
              <Link
                to={pageHref(change.pageTitle)}
                className="min-w-0 flex-1 truncate hover:text-primary hover:underline"
                title={change.pageTitle}
              >
                {change.pageTitle}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground">
                <RelativeTime value={change.createdAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
