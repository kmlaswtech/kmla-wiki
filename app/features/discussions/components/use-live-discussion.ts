import { useCallback, useEffect, useRef } from "react";
import { useNavigation, useRevalidator } from "react-router";

import { getDiscussionVersion } from "../data/queries";
import { useVisibleInterval } from "~/shared/hooks/use-visible-interval";

/** 새 글을 확인하는 간격. */
const CHECK_MS = 5_000;

/**
 * 토론 화면을 거의 실시간으로 맞춘다. 탭이 보이는 동안 5초마다 변경 표만 묻고, 화면의 것과 다르면
 * 라우트를 다시 읽는다. 글쓰기 칸의 글은 컴포넌트 상태라 그대로 남는다. 다시 읽거나 이동하는 중에는
 * 묻지 않는다.
 */
export function useLiveDiscussion(id: number, version: string): void {
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const busy = revalidator.state !== "idle" || navigation.state !== "idle";
  // 타이머가 이전 렌더의 값을 들고 있지 않게 ref로 읽는다.
  const latest = useRef({ id, version, busy, revalidator });
  useEffect(() => {
    latest.current = { id, version, busy, revalidator };
  });

  const check = useCallback(() => {
    const before = latest.current;
    if (before.busy) return;
    getDiscussionVersion(before.id).then(
      (current) => {
        const now = latest.current;
        if (now.id !== before.id || now.busy || current === now.version) return;
        void now.revalidator.revalidate();
      },
      () => undefined,
    );
  }, []);

  useVisibleInterval(check, CHECK_MS);
}
