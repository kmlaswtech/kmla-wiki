import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

import { OPEN_REPORTS_CHANGED } from "../data/mutations";
import { countOpenReports } from "../data/queries";
import { useVisibleInterval } from "~/shared/hooks/use-visible-interval";

/** 화면을 옮길 때 다시 세는 최소 간격. */
const REFRESH_MS = 30_000;
/** 한 화면에 머물 때 다시 세는 간격. */
const POLL_MS = 60_000;

/**
 * 처리되지 않은 신고가 걸린 판 수. 머리띠의 [관리]에 붙인다. 관리자일 때만 센다. 화면을 옮길 때
 * 다시 세고(30초에 한 번까지, 관리 화면으로 갈 때는 늘), 한 화면에 머물면 탭이 보일 때 1분마다 센다.
 * 신고를 닫는 조치가 알리면(`OPEN_REPORTS_CHANGED`) 곧바로 센다. 읽지 못하면 앞의 값을 둔다.
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
    window.addEventListener(OPEN_REPORTS_CHANGED, recount);
    return () => window.removeEventListener(OPEN_REPORTS_CHANGED, recount);
  }, [enabled, recount]);

  useVisibleInterval(recount, POLL_MS, enabled);

  return enabled ? count : 0;
}
