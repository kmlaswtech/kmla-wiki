import { useCallback, useEffect, useRef } from "react";
import { useFetcher, useLocation } from "react-router";

import type { RecentChange } from "../model/types";
import { useVisibleInterval } from "~/shared/hooks/use-visible-interval";

/** 다시 읽는 최소 간격. */
const REFRESH_MS = 30_000;
/** 한 화면에 머무는 동안 다시 읽을지 살피는 간격. */
const POLL_MS = 60_000;

/**
 * 곁의 최근 변경 목록을 `path`(화면 없는 clientLoader 자리)에서 fetcher로 읽는다.
 *
 * 처음과 화면을 옮길 때, 그리고 한 화면에 머무는 동안에도 잠깐씩 다시 읽되 30초보다 자주 읽지
 * 않는다. 저장 같은 action 뒤에는 React Router가 알아서 다시 읽는다. 돌려주는 값은
 * `RecentChangesPanel`의 `changes`와 같다(`undefined`는 읽는 중, `null`은 읽지 못함).
 */
export function useRecentChangesPanel(
  path: string,
): RecentChange[] | null | undefined {
  const fetcher = useFetcher<{ changes: RecentChange[] | null }>({
    key: "recent-panel",
  });
  const { pathname } = useLocation();
  const lastAt = useRef(0);
  const load = fetcher.load;

  const refresh = useCallback(() => {
    if (Date.now() - lastAt.current < REFRESH_MS) return;
    lastAt.current = Date.now();
    void load(path);
  }, [path, load]);

  // 화면을 옮길 때마다 다시 읽을 기회를 준다(간격은 `refresh`가 지킨다).
  const lastPathname = useRef("");
  useEffect(() => {
    if (pathname === lastPathname.current) return;
    lastPathname.current = pathname;
    refresh();
  }, [pathname, refresh]);

  // 타이머는 화면을 옮겨도 그대로 둔다.
  useVisibleInterval(refresh, POLL_MS);

  return fetcher.data?.changes;
}
