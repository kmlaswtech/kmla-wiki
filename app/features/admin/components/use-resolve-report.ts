import { useState } from "react";

import { notifyOpenReportsChanged } from "../data/mutations";
import { isWikiError } from "~/shared/supabase/errors";

export type ReportResolution = "handled" | "dismissed";

/**
 * 관리자 신고 목록의 [처리 완료]·[기각]. 판 신고와 글 신고 목록이 같이 쓴다. 다른 관리자가 먼저
 * 닫았으면(WK011) 오류 대신 목록과 머리띠의 수에서 뺀다.
 */
export function useResolveReport(
  close: (resolution: ReportResolution) => Promise<void>,
  describeError: (error: unknown) => string,
  onChanged: () => void,
): {
  pending: boolean;
  error: string | null;
  resolve: (resolution: ReportResolution) => Promise<void>;
} {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(resolution: ReportResolution) {
    setPending(true);
    setError(null);
    try {
      await close(resolution);
      onChanged();
    } catch (caught) {
      if (isWikiError(caught, "WK011")) {
        notifyOpenReportsChanged();
        onChanged();
      } else setError(describeError(caught));
    } finally {
      setPending(false);
    }
  }

  return { pending, error, resolve };
}
