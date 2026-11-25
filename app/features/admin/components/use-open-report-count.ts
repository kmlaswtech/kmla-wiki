import { OPEN_REPORTS_CHANGED } from "../data/mutations";
import { countOpenReports } from "../data/queries";
import { usePolledCount } from "~/shared/hooks/use-polled-count";

/**
 * 처리되지 않은 신고 수. 머리띠의 [관리]에 붙인다. 관리자일 때만 센다. 관리 화면으로 갈 때는 늘
 * 다시 세고, 신고를 닫는 조치가 알리면(`OPEN_REPORTS_CHANGED`) 곧바로 센다.
 */
export function useOpenReportCount(enabled: boolean): number {
  return usePolledCount(countOpenReports, {
    enabled,
    eagerPath: "/admin",
    changeEvent: OPEN_REPORTS_CHANGED,
  });
}
