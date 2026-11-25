import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { TextChange } from "./text-change";
import {
  POLL_MS,
  type RecentChangesPanelState,
} from "./use-recent-changes-panel";
import type { RecentChange } from "../model/types";
import { pageHref } from "~/features/markup";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { PendingRegion, Skeleton } from "~/shared/ui/skeleton";

/** 읽는 동안 자리를 잡아 두는 줄 수. 실제 목록(10줄)보다 적게 두어 너무 길어 보이지 않게 한다. */
const PENDING_ROWS = 6;
/** 새로고침 아이콘이 한 바퀴 도는 시간. */
const SPIN_MS = 500;

/**
 * 화면 곁(넓은 화면) 또는 맨 아래(좁은 화면)의 최근 변경 목록. 문서마다 한 줄이다.
 *
 * 제목 아래 막대가 다음에 다시 읽기까지 남은 시간만큼 남아 있고, 새로고침 단추는 읽는 동안 돈다.
 * 목록이 본문 아래에 놓이는 좁은 화면(`side` 미만)에서는 막대와 단추를 두지 않는다. 다시 읽어서 새로
 * 들어온 줄은 잠깐 칠한다. 이 목록은 덤이라 읽지 못해도 본문은 그대로 두고 여기에만 알린다.
 */
export function RecentChangesPanel({
  state,
  className,
}: {
  state: RecentChangesPanelState;
  className?: string;
}) {
  const { changes, loading, loadCount, refresh } = state;
  const fresh = useFreshIds(changes);
  // 누르면 읽기가 금방 끝나도 한 바퀴(0.5초)는 돈다. 읽는 중이면 끝날 때까지 돈다. 애니메이션
  // 이벤트에 기대지 않는다. 움직임 줄이기나 숨은 단추에서는 그 이벤트가 오지 않는다.
  const [spinning, setSpinning] = useState(false);
  const busy = loading || spinning;

  return (
    <section aria-labelledby="recent-panel-title" className={className}>
      <div className="relative mb-1 flex items-center gap-1 border-b pb-1.5">
        <h2 id="recent-panel-title" className="font-bold">
          최근 변경
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            setSpinning(true);
            window.setTimeout(() => setSpinning(false), SPIN_MS);
            refresh();
          }}
          disabled={busy}
          aria-label="최근 변경 새로고침"
          // 도는 동안에는 눌리지 않지만 흐리게 하지 않는다.
          className="text-muted-foreground disabled:opacity-100 max-side:hidden"
        >
          <RefreshCw
            className={cn(
              "size-3.5",
              busy && "animate-spin motion-reduce:animate-none",
            )}
            style={{ animationDuration: `${SPIN_MS}ms` }}
            aria-hidden
          />
        </Button>
        <Link
          to="/recent"
          className="ml-auto text-sm text-primary hover:underline"
        >
          더 보기
        </Link>
        {loadCount ? (
          // 읽기를 마칠 때마다 `key`가 바뀌어 막대가 다시 가득 찬 뒤 오른쪽부터 줄어든다.
          <span
            key={loadCount}
            aria-hidden
            className="absolute inset-x-0 -bottom-px h-0.5 origin-left animate-recent-countdown rounded-full bg-primary/50 motion-reduce:hidden max-side:hidden"
            style={{ animationDuration: `${POLL_MS}ms` }}
          />
        ) : null}
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
                "-mx-1.5 flex items-baseline gap-2 rounded-sm px-1.5 py-1 coarse:py-2",
                change.hiddenAt && "opacity-60",
                fresh.has(change.id) &&
                  "animate-recent-arrive motion-reduce:animate-none",
              )}
            >
              <Link
                to={pageHref(change.pageTitle)}
                className="min-w-0 flex-1 truncate hover:text-primary hover:underline"
                title={change.pageTitle}
              >
                {change.pageTitle}
              </Link>
              <TextChange revision={change} className="shrink-0 text-xs" />
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

const NO_IDS: ReadonlySet<number> = new Set();

/**
 * 바로 앞에 보인 목록에 없던 줄의 id. 처음 읽은 목록은 모두 새것이라 칠하지 않는다.
 *
 * 줄의 `key`가 판 id라, 이미 있던 문서가 다시 고쳐져도 새 줄로 그려지고 칠해진다.
 */
function useFreshIds(
  changes: readonly RecentChange[] | null | undefined,
): ReadonlySet<number> {
  // 앞 목록과 비교한 결과를 렌더 중에 바로 고친다(React의 "앞 props 기억" 방식).
  const [previous, setPrevious] = useState(changes);
  const [fresh, setFresh] = useState(NO_IDS);
  if (changes !== previous) {
    setPrevious(changes);
    if (changes && previous) {
      const before = new Set(previous.map((change) => change.id));
      setFresh(
        new Set(
          changes.map((change) => change.id).filter((id) => !before.has(id)),
        ),
      );
    } else {
      setFresh(NO_IDS);
    }
  }
  return fresh;
}

function Notice({ children }: { children: string }) {
  return (
    <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>
  );
}
