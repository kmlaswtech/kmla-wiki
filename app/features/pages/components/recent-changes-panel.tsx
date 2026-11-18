import { Link } from "react-router";

import type { RecentChange } from "../model/types";
import { pageHref } from "~/features/markup";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { PendingRegion, Skeleton } from "~/shared/ui/skeleton";

/** 읽는 동안 자리를 잡아 두는 줄 수. 실제 목록(10줄)보다 적게 두어 너무 길어 보이지 않게 한다. */
const PENDING_ROWS = 6;

/**
 * 화면 곁(넓은 화면) 또는 맨 아래(좁은 화면)의 최근 변경 목록. 문서마다 한 줄이다.
 *
 * `changes`가 `undefined`면 처음 읽는 중이고, `null`이면 읽지 못했다. 이 목록은 덤이라 읽지 못해도
 * 본문은 그대로 두고 여기에만 알린다.
 */
export function RecentChangesPanel({
  changes,
  className,
}: {
  changes: readonly RecentChange[] | null | undefined;
  className?: string;
}) {
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
      {changes === undefined ? (
        <PendingRegion label="최근 변경을" className="space-y-2 py-1.5">
          {Array.from({ length: PENDING_ROWS }, (_, index) => (
            <Skeleton key={index} className="h-4" />
          ))}
        </PendingRegion>
      ) : changes === null ? (
        <Notice>불러오지 못했습니다.</Notice>
      ) : changes.length === 0 ? (
        <Notice>기록이 없습니다.</Notice>
      ) : (
        <ul className="text-sm">
          {changes.map((change) => (
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

function Notice({ children }: { children: string }) {
  return (
    <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>
  );
}
