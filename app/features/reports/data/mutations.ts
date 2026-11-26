import type { ReportCategory, ReportTarget } from "../model/report";
import { getSupabase } from "~/shared/supabase/client";
import { unwrap } from "~/shared/supabase/errors";

/**
 * 판 하나나 토론 글 하나를 관리자에게 신고한다. 신고자는 서버에만 남고 관리자에게도 보이지 않는다.
 * 같은 대상을 다시 신고하거나(WK011) 1시간에 10건을 넘기면(WK019) 서버가 거절한다. 판과 글의 신고는
 * 한도를 함께 센다.
 */
export async function submitReport(
  target: ReportTarget,
  category: ReportCategory,
  note: string,
): Promise<void> {
  const supabase = getSupabase();
  unwrap(
    target.kind === "revision"
      ? await supabase.rpc("report_revision", {
          p_revision_id: target.id,
          p_category: category,
          p_note: note.trim(),
        })
      : await supabase.rpc("report_discussion_post", {
          p_post_id: target.id,
          p_category: category,
          p_note: note.trim(),
        }),
  );
}
