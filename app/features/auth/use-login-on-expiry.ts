import { useCallback } from "react";
import { useNavigate } from "react-router";

import { loginHref } from "./model/next";
import { isWikiError, NOT_VERIFIED } from "~/shared/supabase/errors";

/**
 * 쓰기가 회원 확인 만료로 거절됐으면 로그인으로 보내고 `true`를 돌려준다(로그인 뒤 지금 화면으로
 * 돌아온다). `beforeLeave`는 떠나기 직전에 부른다. 읽기는 `withVerifiedMember`가 맡는다.
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
