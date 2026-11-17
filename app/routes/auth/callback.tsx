import { redirect } from "react-router";

import type { Route } from "./+types/callback";
import {
  completeKmlaSignIn,
  loginHref,
  sanitizeNext,
  signOut,
  takeKmlaSignInNext,
  type KmlaSignInResult,
  type LoginReason,
} from "~/features/auth";

/**
 * "큼온으로 로그인"에서 돌아오는 곳. 화면 없이 회원 확인까지 끝내고 목적지나 로그인 화면으로 보낸다.
 *
 * 승인 회원이 아니거나 확인에 실패하면 로그아웃한다. 회원 확인이 없는 위키 세션은 아무것도 볼 수
 * 없으므로 남겨 둘 이유가 없다.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  const next = takeKmlaSignInNext();
  const code = url.searchParams.get("code");

  if (!code) {
    const reason: LoginReason =
      url.searchParams.get("error") === "access_denied" ? "denied" : "failed";
    throw redirect(loginHref(next, reason));
  }

  let result: KmlaSignInResult | null = null;
  try {
    result = await completeKmlaSignIn(code);
  } catch {
    result = null;
  }

  if (result !== "verified") {
    await signOut();
    throw redirect(loginHref(next, result ?? "failed"));
  }
  throw redirect(sanitizeNext(next) ?? "/");
}

export default function AuthCallback() {
  return null;
}
