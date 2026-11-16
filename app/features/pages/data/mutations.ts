import type { SavedRevision } from "../model/types";
import { getSupabase } from "~/shared/supabase/client";
import { unwrap, WikiError } from "~/shared/supabase/errors";

interface RawSaved {
  page_id: number;
  revision_id: number;
  title: string;
}

function toSaved(rows: RawSaved[]): SavedRevision {
  const row = rows[0];
  if (!row) throw new WikiError("unknown", "The write returned no row.");
  return { pageId: row.page_id, revisionId: row.revision_id, title: row.title };
}

/**
 * 문서를 저장한다. 새 문서는 `baseRevisionId`가 `null`이다.
 *
 * 편집을 시작한 판(`baseRevisionId`)이 더는 현재 판이 아니면 서버가 충돌(WK001)로 거절한다.
 * 권한·보호·차단·상한도 모두 서버가 판정한다. 여기서는 검사하지 않는다.
 */
export async function saveRevision(input: {
  title: string;
  baseRevisionId: number | null;
  body: string;
  summary: string;
}): Promise<SavedRevision> {
  return toSaved(
    unwrap(
      await getSupabase().rpc("save_revision", {
        p_title: input.title,
        // 생성된 타입은 NULL 가능 여부를 모른다. 새 문서는 NULL을 보내야 한다.
        p_base_revision_id: input.baseRevisionId as number,
        p_body: input.body,
        p_summary: input.summary,
      }),
    ),
  );
}

/** 지정한 판의 내용으로 새 판을 만든다. 기록은 지워지지 않는다. */
export async function revertPage(
  revisionId: number,
  summary: string,
): Promise<SavedRevision> {
  return toSaved(
    unwrap(
      await getSupabase().rpc("revert_page", {
        p_revision_id: revisionId,
        p_summary: summary,
      }),
    ),
  );
}

/** 문서 이름을 바꾼다. 하위 문서는 함께 옮기지 않는다. */
export async function movePage(input: {
  title: string;
  newTitle: string;
  leaveRedirect: boolean;
}): Promise<SavedRevision> {
  return toSaved(
    unwrap(
      await getSupabase().rpc("move_page", {
        p_title: input.title,
        p_new_title: input.newTitle,
        p_leave_redirect: input.leaveRedirect,
      }),
    ),
  );
}
