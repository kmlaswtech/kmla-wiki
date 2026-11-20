import type { ReportCategory } from "../model/report";
import { getSupabase } from "~/shared/supabase/client";
import { unwrap } from "~/shared/supabase/errors";

/**
 * 판 하나를 관리자에게 신고한다. 신고자는 서버에만 남고 관리자에게도 보이지 않는다. 같은 판을 다시
 * 신고하거나(WK011) 1시간에 10건을 넘기면(WK019) 서버가 거절한다.
 */
export async function reportRevision(
  revisionId: number,
  category: ReportCategory,
  note: string,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("report_revision", {
      p_revision_id: revisionId,
      p_category: category,
      p_note: note.trim(),
    }),
  );
}
