import { listRecentlyChangedPages, RECENT_PANEL_COUNT } from "~/features/pages";

/**
 * 곁의 최근 변경이 fetcher로 읽는 자리. 화면은 없다(`gate.tsx`).
 *
 * 이 목록은 덤이다. 다른 화면과 달리 `withVerifiedMember`로 감싸지 않고 오류도 던지지 않는다. 던지면
 * 오류 경계가 읽던 문서나 쓰던 글을 덮고, 확인이 만료됐을 때는 로그인 뒤 돌아올 곳이 이 주소가 된다.
 * 확인 만료는 사용자가 보는 화면의 loader가 알린다. 여기서는 `null`(읽지 못함)만 돌려준다.
 */
export async function clientLoader() {
  try {
    return { changes: await listRecentlyChangedPages(RECENT_PANEL_COUNT) };
  } catch {
    return { changes: null };
  }
}
