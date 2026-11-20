import { useEffect, useState } from "react";

/** idle 콜백이 없는 브라우저(Safari)에서 기다리는 시간. */
const FALLBACK_DELAY_MS = 1500;

/**
 * 첫 화면을 그린 뒤 브라우저가 한가해지면 `true`가 된다. 급하지 않은 일(다음 화면 코드 미리 받기
 * 등)을 첫 화면의 코드·데이터 요청과 겹치지 않게 미룬다.
 */
export function useAfterIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => setIdle(true));
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(() => setIdle(true), FALLBACK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return idle;
}
