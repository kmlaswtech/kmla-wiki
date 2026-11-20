import { useEffect } from "react";

/**
 * 탭이 보이는 동안 `intervalMs`마다 `callback`을 부른다. 한 화면에 오래 머물 때 목록이나 수를 다시
 * 읽는 데 쓴다. 숨은 탭에서는 부르지 않는다. `enabled`가 거짓이면 타이머를 두지 않는다.
 */
export function useVisibleInterval(
  callback: () => void,
  intervalMs: number,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") callback();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [callback, intervalMs, enabled]);
}
