import { useSyncExternalStore } from "react";

import { formatAbsoluteTime, formatRelativeTime } from "~/shared/lib/time";

// 화면의 모든 상대 시각이 같은 시계를 본다. 1분마다 한 번 다시 그린다.
let now = 0;
const listeners = new Set<() => void>();
let timer: number | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    now = Date.now();
    timer = window.setInterval(() => {
      now = Date.now();
      listeners.forEach((notify) => notify());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

/**
 * "3분전" 같은 상대 시각. 전체 시각은 `title`과 `dateTime`에 둔다.
 *
 * 빌드 시점 렌더에는 "지금"이 없으므로 전체 시각을 그리고, 브라우저에서 상대 시각으로 바뀐다.
 */
export function RelativeTime({ value }: { value: string }) {
  const current = useSyncExternalStore(
    subscribe,
    // 구독 전에도 같은 값을 돌려줘야 한다. 부를 때마다 `Date.now()`를 새로 읽으면 React가 무한
    // 다시 그리기를 경고한다.
    () => (now ||= Date.now()),
    () => null,
  );

  const absolute = formatAbsoluteTime(value) ?? value;
  const relative = current === null ? null : formatRelativeTime(value, current);

  return (
    <time dateTime={value} title={absolute}>
      {relative ?? absolute}
    </time>
  );
}
