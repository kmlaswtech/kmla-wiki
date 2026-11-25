import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

import { useVisibleInterval } from "./use-visible-interval";

/** 화면을 옮길 때 다시 세는 최소 간격. */
const REFRESH_MS = 30_000;
/** 한 화면에 머물 때 다시 세는 간격. */
const POLL_MS = 60_000;

/**
 * 머리띠에 붙이는 수(처리할 신고, 읽지 않은 알림). 화면을 옮길 때 다시 세고(30초에 한 번까지,
 * `eagerPath`로 갈 때는 같은 화면을 다시 열어도 늘), 한 화면에 머물면 탭이 보일 때 1분마다 센다. `changeEvent` 창 이벤트가
 * 오면 곧바로 센다. 읽지 못하면 앞의 값을 둔다. `enabled`가 거짓이면 세지 않고 0이다.
 *
 * `load`는 렌더마다 새로 만들지 않는다(모듈의 함수를 그대로 넘긴다).
 */
export function usePolledCount(
  load: () => Promise<number>,
  {
    enabled = true,
    eagerPath,
    changeEvent,
  }: { enabled?: boolean; eagerPath?: string; changeEvent?: string } = {},
): number {
  // `key`는 같은 주소로 다시 이동해도 바뀐다. 알림 화면에서 [알림]을 다시 누르면 다시 읽음 처리된다.
  const { pathname, key } = useLocation();
  const [count, setCount] = useState(0);
  const lastAt = useRef(0);
  const lastKey = useRef<string | null>(null);
  const latestRequest = useRef(0);

  const recount = useCallback(() => {
    lastAt.current = Date.now();
    // 늦게 끝난 앞 요청이 새 수를 덮지 않게 마지막 요청의 결과만 쓴다.
    const request = ++latestRequest.current;
    load().then(
      (value) => {
        if (request === latestRequest.current) setCount(value);
      },
      () => undefined,
    );
  }, [load]);

  useEffect(() => {
    if (!enabled || lastKey.current === key) return;
    lastKey.current = key;
    if (pathname !== eagerPath && Date.now() - lastAt.current < REFRESH_MS)
      return;
    recount();
  }, [enabled, key, pathname, eagerPath, recount]);

  useEffect(() => {
    if (!enabled || !changeEvent) return;
    window.addEventListener(changeEvent, recount);
    return () => window.removeEventListener(changeEvent, recount);
  }, [enabled, changeEvent, recount]);

  useVisibleInterval(recount, POLL_MS, enabled);

  return enabled ? count : 0;
}
