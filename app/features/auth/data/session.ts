import type { MemberStatus } from "../model/types";
import { getSupabase } from "~/shared/supabase/client";
import { unwrap } from "~/shared/supabase/errors";

/**
 * 로그인 상태와 위키 이용 상태. 세션이 없으면 `null`.
 *
 * 로그인 방식("큼온으로 로그인"과 로컬 개발 로그인)은 이 파일 안에서만 안다.
 * 나머지 앱은 `MemberStatus`만 본다.
 */
export async function loadMemberStatus(): Promise<MemberStatus | null> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;

  const rows = unwrap(await supabase.rpc("get_my_status"));
  const row = rows[0];
  if (!row) return null;

  return {
    isMember: row.is_member,
    verified: row.verified,
    verifiedUntil: row.verified_until,
    isAdmin: row.is_admin,
    ban: row.banned
      ? { endsAt: row.ban_ends_at, reason: row.ban_reason ?? "" }
      : null,
  };
}

/** 위키 Supabase에 등록한 KMLA Online OIDC 제공자. */
const KMLA_PROVIDER = "custom:kmla";
/** 로그인 뒤 돌아갈 주소. 콜백 주소에 쿼리를 붙이면 허용 주소와 정확히 맞지 않아 따로 둔다. */
const NEXT_KEY = "kmla-sign-in-next";

/**
 * "큼온으로 로그인"을 시작한다. kmla.online 로그인·동의 화면을 거쳐 `/auth/callback`으로 돌아온다.
 * 성공하면 이 함수가 돌아오기 전에 화면이 바뀐다.
 */
export async function startKmlaSignIn(next: string | null): Promise<void> {
  try {
    window.sessionStorage.setItem(NEXT_KEY, next ?? "");
  } catch {
    // 저장소를 못 쓰면 로그인 뒤 대문으로 간다.
  }
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: KMLA_PROVIDER,
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) throw error;
}

/** `startKmlaSignIn`에 넘긴 돌아갈 주소를 꺼내고 지운다. 검사는 부르는 쪽이 한다. */
export function takeKmlaSignInNext(): string | null {
  try {
    const next = window.sessionStorage.getItem(NEXT_KEY);
    window.sessionStorage.removeItem(NEXT_KEY);
    return next || null;
  } catch {
    return null;
  }
}

export type KmlaSignInResult = "verified" | "not-member";

/**
 * 콜백의 인가 코드로 위키 세션을 받고, 같이 온 KMLA 토큰으로 회원 확인(`kmla-verify`)을 한 번 한다.
 *
 * KMLA 토큰은 KMLA에서 그 사용자의 권한을 가진다. 확인이 끝나면 세션을 새로 받아 이 브라우저
 * 저장소에 남은 토큰을 지운다. 확인에 실패하면 예외를 던진다(세션 정리는 부르는 쪽이 한다).
 */
export async function completeKmlaSignIn(
  code: string,
): Promise<KmlaSignInResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;

  try {
    const providerToken = data.session.provider_token;
    if (!providerToken) throw new Error("KMLA 토큰을 받지 못했습니다.");

    const { data: result, error: verifyError } =
      await supabase.functions.invoke<{ verified: boolean }>("kmla-verify", {
        body: { providerToken },
      });
    if (verifyError) throw verifyError;
    if (typeof result?.verified !== "boolean") {
      throw new Error("회원 확인 응답이 올바르지 않습니다.");
    }
    return result.verified ? "verified" : "not-member";
  } finally {
    await supabase.auth.refreshSession().catch(() => undefined);
  }
}

/**
 * 로컬 개발·E2E 전용. seed 계정의 이메일·비밀번호로 들어간다.
 *
 * 운영 Supabase는 이메일 로그인이 꺼져 있어 이 호출이 실패한다.
 */
export async function signInForDevelopment(
  email: string,
  password: string,
): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  // 서버 요청이 실패해도 이 브라우저의 세션은 지운다.
  await getSupabase().auth.signOut({ scope: "local" });
}
