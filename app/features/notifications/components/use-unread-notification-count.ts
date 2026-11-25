import { countUnreadNotifications } from "../data/queries";
import { usePolledCount } from "~/shared/hooks/use-polled-count";

/**
 * 읽지 않은 알림 수. 머리띠의 [알림]에 붙인다. 알림 화면으로 갈 때는 늘 다시 센다. 그 화면이 알림을
 * 읽음으로 바꾸므로 0이 된다.
 */
export function useUnreadNotificationCount(): number {
  return usePolledCount(countUnreadNotifications, {
    eagerPath: "/notifications",
  });
}
