import type { MemberStatus } from "../model/types";
import { getSupabase } from "~/shared/supabase/client";
import { unwrap } from "~/shared/supabase/errors";

/**
 * 로그인 상태와 위키 이용 상태. 세션이 없으면 `null`.
 *
 * 로그인 방식(지금은 로컬 개발 로그인, 나중에는 "큼온으로 로그인")은 이 파일 안에서만 안다.
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
