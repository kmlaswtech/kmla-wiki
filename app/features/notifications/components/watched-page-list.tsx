import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { setPageWatched } from "../data/mutations";
import { describeWatchError } from "../model/errors";
import type { WatchedPage } from "../model/types";
import { pageHref } from "~/features/markup";
import { RelativeTime } from "~/shared/components/relative-time";
import { Button } from "~/shared/ui/button";

/** 내 즐겨찾기 목록. 줄마다 [빼기]가 있다. 뺀 줄은 바로 사라진다. */
export function WatchedPageList({
  pages: initial,
}: {
  pages: readonly WatchedPage[];
}) {
  const [pages, setPages] = useState(initial);
  const [pendingId, setPendingId] = useState<number | null>(null);

  async function unwatch(page: WatchedPage) {
    setPendingId(page.pageId);
    try {
      await setPageWatched(page.pageId, false);
      setPages((current) =>
        current.filter((entry) => entry.pageId !== page.pageId),
      );
    } catch (error) {
      toast.error(describeWatchError(error));
    } finally {
      setPendingId(null);
    }
  }

  if (pages.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground">
        즐겨찾기한 문서가 없습니다. 문서 위의 별표를 누르면 즐겨찾기에
        더해집니다.
      </p>
    );
  }
  return (
    <ul className="divide-y text-sm">
      {pages.map((page) => (
        <li key={page.pageId} className="flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <Link
              to={pageHref(page.pageTitle)}
              className="break-words text-primary hover:underline"
            >
              {page.pageTitle}
            </Link>
            <p className="text-muted-foreground">
              <RelativeTime value={page.watchedAt} />에 더함
              {page.pageDeleted ? " · 삭제된 문서" : null}
            </p>
          </div>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={pendingId === page.pageId}
            aria-label={`${page.pageTitle} 즐겨찾기에서 빼기`}
            onClick={() => void unwatch(page)}
          >
            빼기
          </Button>
        </li>
      ))}
    </ul>
  );
}
