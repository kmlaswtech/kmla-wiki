import { useCallback } from "react";
import { useNavigate } from "react-router";

import { loginHref } from "./model/next";
import { isWikiError, NOT_VERIFIED } from "~/shared/supabase/errors";

/**
 * 쓰기 중에 회원 확인이 지나 거절됐으면 로그인 화면으로 보낸다. 로그인 뒤에는 지금 화면으로
 * 돌아온다. 읽기(`clientLoader`)는 `withVerifiedMember`가 같은 일을 한다.
 *
 * 돌려주는 함수는 오류가 확인 만료였으면 `true`다. `beforeLeave`는 떠나기 직전에 부른다(쓰던
 * 글을 임시 저장하는 등).
 */
export function useLoginOnExpiry(): (
  error: unknown,
  beforeLeave?: () => void,
) => Promise<boolean> {
  const navigate = useNavigate();
  return useCallback(
    async (error, beforeLeave) => {
      if (!isWikiError(error, NOT_VERIFIED)) return false;
      beforeLeave?.();
      await navigate(
        loginHref(`${location.pathname}${location.search}`, "expired"),
      );
      return true;
    },
    [navigate],
  );
}
