import { Star } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { setPageWatched } from "../data/mutations";
import { describeWatchError } from "../model/errors";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";

/**
 * 문서의 별표와 즐겨찾기한 회원 수. 누르면 즐겨찾기에 더하고, 다시 누르면 뺀다. 즐겨찾기한 문서가
 * 편집되거나 새 토론이 열리면 알림이 온다. 누르는 즉시 모양과 수를 바꾸고, 실패하면 되돌린다. 문서마다
 * 새로 그린다(`key`).
 */
export function WatchButton({
  pageId,
  watched: initialWatched,
  watchers: initialWatchers,
}: {
  pageId: number;
  watched: boolean;
  watchers: number;
}) {
  const [watched, setWatched] = useState(initialWatched);
  const [watchers, setWatchers] = useState(initialWatchers);
  const [pending, setPending] = useState(false);

  async function toggle() {
    const next = !watched;
    const step = next ? 1 : -1;
    setWatched(next);
    setWatchers((count) => Math.max(0, count + step));
    setPending(true);
    try {
      await setPageWatched(pageId, next);
    } catch (error) {
      setWatched(!next);
      setWatchers((count) => Math.max(0, count - step));
      toast.error(describeWatchError(error));
    } finally {
      setPending(false);
    }
  }

  const action = watched ? "즐겨찾기에서 빼기" : "즐겨찾기에 더하기";
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={`${action}, ${watchers}명이 즐겨찾기함`}
      aria-pressed={watched}
      title={action}
      disabled={pending}
      onClick={() => void toggle()}
    >
      <Star
        aria-hidden
        className={cn(watched && "fill-amber-400 text-amber-500")}
      />
      <span className="tabular-nums">{watchers}</span>
    </Button>
  );
}
