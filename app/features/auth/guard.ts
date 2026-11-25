import { redirect } from "react-router";

import { loadMemberStatus } from "./data/session";
import { loginHref, unverifiedReason } from "./model/next";
import { isWikiError, NOT_VERIFIED } from "~/shared/supabase/errors";

/** 요청한 주소의 경로와 쿼리. 로그인 뒤 돌아올 곳으로 쓴다. */
export function pathOf(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

/**
 * 읽기를 실행하고, 회원 확인이 지나서 거절됐으면 로그인 화면으로 보낸다.
 *
 * 게이트는 첫 진입에만 상태를 확인한다. 화면을 열어 둔 사이 확인 기간이 지나면 다음 요청이
 * 여기서 걸린다.
 *
 * 권한 오류(42501)는 로그인이 없거나, 회원이 아니거나, 확인이 지났을 때 모두 온다. 그래서 사유는
 * 상태를 다시 읽어 게이트와 같은 방식(`unverifiedReason`)으로 정한다. 확인이 살아 있으면 다른
 * 권한 문제(관리자 전용 등)이므로 오류를 그대로 던진다.
 */
export async function withVerifiedMember<T>(
  request: Request,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isWikiError(error, NOT_VERIFIED)) {
      const status = await loadMemberStatus();
      if (!status?.verified) {
        throw redirect(loginHref(pathOf(request), unverifiedReason(status)));
      }
    }
    throw error;
  }
}
