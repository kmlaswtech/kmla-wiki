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

/** 로그인 화면 주소. 지금 보려던 곳을 `next`로 담는다. 대문은 기본 목적지라 담지 않는다. */
export function loginHref(
  next: string | null,
  reason?: "expired" | "not-member",
): string {
  const params = new URLSearchParams();
  const safeNext = sanitizeNext(next);
  if (safeNext && safeNext !== "/") params.set("next", safeNext);
  if (reason) params.set("reason", reason);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}
