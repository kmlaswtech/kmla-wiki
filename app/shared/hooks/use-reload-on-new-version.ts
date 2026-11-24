import { useEffect } from "react";
import { createPath, useNavigation } from "react-router";

import { useVisibleInterval } from "./use-visible-interval";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const CHECK_GAP_MS = 30 * 1000;

// 앱 전체에 하나뿐인 상태다. 훅은 root에서 한 번만 부른다.
let stale = false;
let lastCheck = 0;

/** `/version.json`을 읽어 지금 코드보다 새 배포가 있는지 본다. 짧은 시간 안에 다시 읽지 않는다. */
function check(): void {
  if (import.meta.env.DEV || stale) return;
  const now = Date.now();
  if (now - lastCheck < CHECK_GAP_MS) return;
  lastCheck = now;
  void isNewVersionOut().then((out) => {
    if (out) stale = true;
  });
}

async function isNewVersionOut(): Promise<boolean> {
  try {
    const response = await fetch("/version.json", { cache: "no-cache" });
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

function onVisible(): void {
  if (document.visibilityState === "visible") check();
}

/**
 * 새 배포가 나오면 열어 둔 탭도 새 코드로 바꾼다. 알림은 보이지 않는다.
 *
 * - 탭이 다시 보일 때와 5분마다 `/version.json`을 읽어, 지금 코드의 빌드 값과 다른지 본다.
 * - 다르면 다음 링크 이동을 문서 전체 로드로 바꾼다. 새 화면을 옛 코드로 그리지 않고, 보던 화면이
 *   갑자기 바뀌지도 않는다. 나가기 확인(`useBlocker`)을 지난 이동만 여기에 온다.
 * - 폼 제출 뒤의 이동은 그대로 둔다(저장 결과를 보여야 한다). 해시만 바뀌는 이동은 loading을
 *   거치지 않는다.
 * - 라우트 모듈을 못 받으면 React Router가 스스로 새로 고친다. 함수 안의 동적 import(이미지
 *   변환 등)를 못 받으면(`vite:preloadError`) 바로 새 버전을 확인한다. 연결이 잠깐 끊긴 때 쓰던
 *   화면을 버리지 않으려고 바로 새로 고치지는 않는다.
 */
export function useReloadOnNewVersion(): void {
  const navigation = useNavigation();

  useVisibleInterval(check, CHECK_INTERVAL_MS);

  useEffect(() => {
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("vite:preloadError", check);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("vite:preloadError", check);
    };
  }, []);

  useEffect(() => {
    if (stale && navigation.state === "loading" && !navigation.formMethod) {
      window.location.assign(createPath(navigation.location));
    }
  }, [navigation]);
}
