import { useEffect, useState } from "react";

/**
 * 값이 `delayMs` 동안 그대로면 그 값을 돌려준다. 치는 동안 글자마다 요청하지 않고, 입력이 멈춘 뒤
 * 한 번만 찾게 한다. 처음 값은 기다리지 않고 바로 돌려준다.
 *
 * 늦게 도착한 앞선 응답은 이 훅이 막지 않는다. 요청하는 쪽이 effect 정리 함수로 버린다.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
