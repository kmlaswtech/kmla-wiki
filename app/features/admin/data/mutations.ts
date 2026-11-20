import type { BulkRevertResult } from "../model/bulk-revert";
import { getSupabase } from "~/shared/supabase/client";
import { unwrap } from "~/shared/supabase/errors";

/** 신고가 닫혔을 수 있다는 알림. 머리띠의 신고 수(`useOpenReportCount`)가 받아 다시 센다. */
export const OPEN_REPORTS_CHANGED = "wiki:open-reports-changed";

/**
 * 신고를 닫는 조치(신고 닫기, 판 숨기기, 문서 삭제, 일괄 되돌리기)가 성공한 뒤 알린다. 화면이 조치마다
 * 따로 부르지 않게 이 파일의 함수들이 부른다.
 */
export function notifyOpenReportsChanged(): void {
  window.dispatchEvent(new Event(OPEN_REPORTS_CHANGED));
}

/**
 * 관리 조치. 관리자 여부, 사유, 대상 상태는 모두 서버가 검사한다.
 *
 * 대상은 "판"이다. 가명은 문서마다 달라서 사람을 가리키지 못하고, 서버가 판에서 사람을 찾는다.
 * 어떤 조치도 그 사람이 누구인지 돌려주지 않는다.
 */

/**
 * 판 작성자의 편집을 모든 문서에서 막는다. `length`는 Postgres interval 글(`3 day`)이고, `null`이면
 * 기한 없음. 끝나는 시각은 서버가 정한다.
 */
export async function banEditor(
  revisionId: number,
  length: string | null,
  reason: string,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("ban_editor", {
      p_revision_id: revisionId,
      // 생성된 타입은 NULL 가능 여부를 모른다. 기한 없는 차단은 NULL을 보낸다.
      p_length: length as string,
      p_reason: reason,
    }),
  );
}

/** 진행 중인 차단의 기간을 지금부터 다시 정한다. `length`는 `banEditor`와 같다. */
export async function changeBanEnd(
  banId: number,
  length: string | null,
  reason: string,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("change_ban_end", {
      p_ban_log_id: banId,
      p_length: length as string,
      p_reason: reason,
    }),
  );
}

/**
 * 판 작성자의 다른 편집을 보는 허가를 연다. 사유와 함께 공개 기록에 남고, 10분 동안 유효하다.
 * 같은 사람에 대해 2분 넘게 남은 허가가 있으면 그것을 돌려주고 다시 기록하지 않는다.
 */
export async function openAuthorLookup(
  revisionId: number,
  reason: string,
): Promise<string> {
  return unwrap(
    await getSupabase().rpc("open_author_lookup", {
      p_revision_id: revisionId,
      p_reason: reason,
    }),
  );
}

/**
 * 일괄 되돌리기. `items`는 미리보기 때의 문서와 현재 판이다. 서버가 문서를 잠그고 계획을 다시 세워,
 * 그사이 현재 판이 바뀐 문서는 건너뛴다. 한 번에 200개까지(WK018).
 */
export async function bulkRevert(
  lookupId: string,
  fromRevisionId: number | null,
  items: readonly { pageId: number; currentRevisionId: number }[],
  reason: string,
): Promise<BulkRevertResult[]> {
  const rows = unwrap(
    await getSupabase().rpc("bulk_revert", {
      p_lookup_id: lookupId,
      // 생성된 타입은 NULL 가능 여부를 모른다. NULL이면 대상의 모든 편집이다.
      p_from_revision_id: fromRevisionId as number,
      p_items: items.map((item) => ({
        page_id: item.pageId,
        current_revision_id: item.currentRevisionId,
      })),
      p_reason: reason,
    }),
  );
  notifyOpenReportsChanged();
  return rows.map((row) => ({
    pageId: row.page_id,
    outcome: row.outcome as BulkRevertResult["outcome"],
  }));
}

/** 판 하나의 처리되지 않은 신고를 모두 닫는다. 결과는 비공개로 남는다. */
export async function resolveReports(
  revisionId: number,
  resolution: "handled" | "dismissed",
): Promise<void> {
  unwrap(
    await getSupabase().rpc("resolve_reports", {
      p_revision_id: revisionId,
      p_resolution: resolution,
    }),
  );
  notifyOpenReportsChanged();
}

export async function liftBan(banId: number, reason: string): Promise<void> {
  unwrap(
    await getSupabase().rpc("lift_ban", {
      p_ban_log_id: banId,
      p_reason: reason,
    }),
  );
}

export async function setProtection(
  pageId: number,
  level: "open" | "admin",
  reason: string,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("set_protection", {
      p_page_id: pageId,
      p_level: level,
      p_reason: reason,
    }),
  );
}

/** 삭제는 숨기는 것이다. 판 기록은 남고 복구할 수 있다. */
export async function deletePage(
  pageId: number,
  reason: string,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("delete_page", {
      p_page_id: pageId,
      p_reason: reason,
    }),
  );
  notifyOpenReportsChanged();
}

export async function restorePage(
  pageId: number,
  reason: string,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("restore_page", {
      p_page_id: pageId,
      p_reason: reason,
    }),
  );
}

export async function setRevisionHidden(
  revisionId: number,
  hidden: boolean,
  reason: string,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("set_revision_hidden", {
      p_revision_id: revisionId,
      p_hidden: hidden,
      p_reason: reason,
    }),
  );
  if (hidden) notifyOpenReportsChanged();
}

/**
 * 판을 숨긴다. 현재 판이면 먼저 그 앞의 보이는 판으로 되돌리고, 그런 판이 없으면 문서를 삭제한다.
 * 그 판의 신고는 닫힌다.
 */
export async function revertAndHideRevision(
  revisionId: number,
  reason: string,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("revert_and_hide_revision", {
      p_revision_id: revisionId,
      p_reason: reason,
    }),
  );
  notifyOpenReportsChanged();
}

export async function grantAdmin(
  revisionId: number,
  reason: string,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("grant_admin", {
      p_revision_id: revisionId,
      p_reason: reason,
    }),
  );
}

export async function revokeAdmin(
  handle: string,
  reason: string,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("revoke_admin", {
      p_admin_handle: handle,
      p_reason: reason,
    }),
  );
}
