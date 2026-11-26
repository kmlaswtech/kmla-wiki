import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher, useLocation } from "react-router";

import type { RecentChange } from "../model/types";

/** 저절로 다시 읽는 최소 간격. 새로고침 단추는 이 간격을 따르지 않는다. */
const REFRESH_MS = 30_000;
/** 한 화면에 머무는 동안 마지막으로 읽은 뒤 다시 읽기까지의 시간. */
export const POLL_MS = 60_000;

export interface RecentChangesPanelState {
  /** `undefined`는 처음 읽는 중, `null`은 읽지 못함. */
  changes: RecentChange[] | null | undefined;
  /** 다시 읽는 중이다. */
  loading: boolean;
  /** 읽기를 마친 횟수. 읽기를 마칠 때마다 바뀌고, 아직 읽지 않았으면 0. */
  loadCount: number;
  /** 바로 다시 읽는다(새로고침 단추). */
  refresh: () => void;
}

/**
 * 곁의 최근 변경 목록을 `path`(화면 없는 clientLoader 자리)에서 fetcher로 읽는다.
 *
 * 처음과 화면을 옮길 때, 마지막으로 읽고 1분이 지났을 때, 숨었던 탭이 다시 보일 때 다시 읽는다.
 * 저절로는 30초보다 자주 읽지 않는다. 저장 같은 action 뒤에는 React Router가 알아서 다시 읽는다.
 */
export function useRecentChangesPanel(path: string): RecentChangesPanelState {
  const fetcher = useFetcher<{ changes: RecentChange[] | null }>({
    key: "recent-panel",
  });
  const { pathname } = useLocation();
  const lastAt = useRef(0);
  const load = fetcher.load;

  // 읽기를 마친 때를 기준으로 막대와 다음 읽기를 맞춘다. 저장 뒤 React Router가 스스로 다시 읽은
  // 때도 `data`가 바뀌므로 함께 잡힌다.
  const data = fetcher.data;
  const [seenData, setSeenData] = useState(data);
  const [loadCount, setLoadCount] = useState(0);
  if (data !== seenData) {
    setSeenData(data);
    if (data) setLoadCount((count) => count + 1);
  }

  const reload = useCallback(
    (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastAt.current < REFRESH_MS) return;
      lastAt.current = now;
      void load(path);
    },
    [path, load],
  );

  // 화면을 옮길 때마다 다시 읽을 기회를 준다(간격은 `reload`가 지킨다).
  const lastPathname = useRef("");
  useEffect(() => {
    if (pathname === lastPathname.current) return;
    lastPathname.current = pathname;
    reload(false);
  }, [pathname, reload]);

  // 마지막으로 읽고 `POLL_MS`가 지나면 다시 읽는다. 화면의 남은 시간 막대와 맞춘다. 탭이 숨어
  // 있으면 건너뛰고, 다시 보일 때 읽는다.
  useEffect(() => {
    if (!loadCount) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible") reload(false);
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [loadCount, reload]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") reload(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [reload]);

  const refresh = useCallback(() => reload(true), [reload]);

  return {
    changes: data?.changes,
    loading: fetcher.state !== "idle",
    loadCount,
    refresh,
  };
}
