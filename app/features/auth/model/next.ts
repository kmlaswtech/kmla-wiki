import type { MemberStatus } from "./types";

/**
 * 로그인 뒤에 돌아갈 주소(`next`)를 검사한다.
 *
 * `next`는 주소창에서 오므로 믿을 수 없다. 앱 안의 경로만 통과시켜, 로그인 링크를 꾸며 다른
 * 사이트로 보내는 것을 막는다.
 */
const ORIGIN = "https://wiki.invalid";

export function sanitizeNext(value: string | null | undefined): string | null {
  if (!value?.startsWith("/") || value.startsWith("//")) return null;

  try {
    const url = new URL(value, ORIGIN);
    if (url.origin !== ORIGIN) return null;
    // 로그인 화면으로 되돌아가면 갇힌다.
    if (url.pathname === "/login" || url.pathname.startsWith("/auth/")) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * 로그인 화면에 보여 줄 사유.
 * - `expired`: 회원 확인 기간이 지났다.
 * - `not-member`: 승인된 KMLA Online 회원이 아니다.
 * - `denied`: kmla.online 동의 화면에서 거부했다(미승인 회원이면 KMLA가 거부만 허용한다).
 * - `failed`: 로그인이나 회원 확인 중 오류가 났다.
 */
export type LoginReason = "expired" | "not-member" | "denied" | "failed";

/**
 * 회원 확인이 없는 상태에서 로그인 화면에 붙일 사유. 세션이 없으면(`null`) 사유를 붙이지 않는다.
 *
 * 게이트와 `withVerifiedMember`가 함께 쓴다. 처음 들어올 때 두 loader가 함께 돌고 React Router는 가장
 * 안쪽 redirect를 따르므로, 둘이 같은 사유를 내야 어느 쪽을 따라도 같다.
 */
export function unverifiedReason(
  status: MemberStatus | null,
): LoginReason | undefined {
  if (!status) return undefined;
  return status.isMember ? "expired" : "not-member";
}

/** 로그인 화면 주소. 지금 보려던 곳을 `next`로 담는다. 대문은 기본 목적지라 담지 않는다. */
export function loginHref(next: string | null, reason?: LoginReason): string {
  const params = new URLSearchParams();
  const safeNext = sanitizeNext(next);
  if (safeNext && safeNext !== "/") params.set("next", safeNext);
  if (reason) params.set("reason", reason);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}
