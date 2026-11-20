import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

import { countOpenReports } from "../data/queries";

/** 화면을 옮길 때 다시 세는 최소 간격. */
const REFRESH_MS = 30_000;

/** 신고를 닫았다는 알림. 신고 목록이 보내고 머리띠의 수가 받는다. */
const CHANGED_EVENT = "wiki:open-reports-changed";

/** 신고를 닫은 뒤 부른다. 머리띠의 수를 곧바로 다시 센다. */
export function notifyOpenReportsChanged(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/**
 * 처리되지 않은 신고가 걸린 판 수. 머리띠의 [관리]에 붙인다. 관리자일 때만 센다. 화면을 옮길 때
 * 다시 세고(30초에 한 번까지, 관리 화면으로 갈 때는 늘), 신고를 닫았다는 알림을 받으면 곧바로 센다.
 * 읽지 못하면 앞의 값을 둔다.
 */
export function useOpenReportCount(enabled: boolean): number {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);
  const lastAt = useRef(0);

  const recount = useCallback(() => {
    lastAt.current = Date.now();
    countOpenReports().then(setCount, () => undefined);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (pathname !== "/admin" && Date.now() - lastAt.current < REFRESH_MS)
      return;
    recount();
  }, [enabled, pathname, recount]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener(CHANGED_EVENT, recount);
    return () => window.removeEventListener(CHANGED_EVENT, recount);
  }, [enabled, recount]);

  return enabled ? count : 0;
}
