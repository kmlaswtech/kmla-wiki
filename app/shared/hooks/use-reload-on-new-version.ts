import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router";

import { useVisibleInterval } from "./use-visible-interval";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const PRELOAD_RELOAD_KEY = "app:preload-reload";
const PRELOAD_RELOAD_GAP_MS = 10_000;

/**
 * 새 배포가 나오면 열어 둔 탭도 새 코드로 바꾼다. 알림은 보이지 않는다.
 *
 * - 탭이 다시 보일 때와 5분마다 `/version.json`을 읽어, 지금 코드의 빌드 값과 다른지 본다.
 * - 다르면 다음 화면 이동이 끝난 뒤 그 주소를 새로 받는다. 보던 화면이 갑자기 바뀌지 않는다.
 *   새 화면이 떠나기를 막으면(편집기가 임시 저장을 불러온 경우 등) 그다음 이동까지 미룬다.
 * - 화면 이동이 끝난 뒤에 하므로 나가기 확인(`useBlocker`)은 이미 끝난 상태다.
 * - 라우트 모듈을 못 받으면 React Router가 스스로 새로 고친다. 함수 안의 동적 import(이미지
 *   변환 등)는 Vite의 `vite:preloadError`로 받아 한 번 새로 고친다.
 */
export function useReloadOnNewVersion(): void {
  const stale = useRef(false);
  const location = useLocation();
  // 해시만 바뀌는 이동(각주, 목차)은 화면 이동으로 보지 않는다.
  const page = location.pathname + location.search;
  const shownPage = useRef(page);

  const check = useCallback(() => {
    if (import.meta.env.DEV || stale.current) return;
    void isNewVersionOut().then((out) => {
      if (out) stale.current = true;
    });
  }, []);

  useVisibleInterval(check, CHECK_INTERVAL_MS);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") check();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check]);

  useEffect(() => {
    if (page === shownPage.current) return;
    shownPage.current = page;
    if (stale.current && !leaveBlocked()) window.location.reload();
  }, [page]);

  useEffect(() => {
    function onPreloadError(event: Event) {
      if (reloadedRecently()) return;
      event.preventDefault();
      window.location.reload();
    }
    window.addEventListener("vite:preloadError", onPreloadError);
    return () =>
      window.removeEventListener("vite:preloadError", onPreloadError);
  }, []);
}

async function isNewVersionOut(): Promise<boolean> {
  try {
    const response = await fetch("/version.json", { cache: "no-store" });
    if (!response.ok) return false;
    const { version } = (await response.json()) as { version?: unknown };
    return (
      typeof version === "string" && version !== import.meta.env.APP_VERSION
    );
  } catch {
    // 연결이 끊긴 때 등. 다음 확인에서 다시 본다.
    return false;
  }
}

/** 지금 화면이 `beforeunload`로 떠나기를 막는지 본다. 막는 화면에서 새로 고치면 경고가 뜬다. */
function leaveBlocked(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** 새 배포 뒤에도 파일을 계속 못 받는 경우, 새로 고침을 되풀이하지 않게 한다. */
function reloadedRecently(): boolean {
  try {
    const last = Number(sessionStorage.getItem(PRELOAD_RELOAD_KEY));
    const now = Date.now();
    if (now - last < PRELOAD_RELOAD_GAP_MS) return true;
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(now));
    return false;
  } catch {
    return true;
  }
}
