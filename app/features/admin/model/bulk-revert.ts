/** 한 번에 처리할 수 있는 문서 수. 서버(`bulk_revert`, WK018)와 같다. */
export const BULK_REVERT_MAX = 200;

/**
 * 문서 하나의 계획(`preview_bulk_revert`).
 * - revert: 현재 판이 대상의 판이다. `restoreRevisionId`로 되돌린다.
 * - delete: 돌아갈 판이 없다(대상이 만든 문서). 삭제한다.
 * - same: 되돌려도 본문이 같다(이동만 했거나 스스로 되돌렸다).
 * - clean: 다른 사람이 이미 대상의 첫 편집 앞 본문으로 되돌렸다.
 * - hidden: 돌아갈 판이 숨긴 판이다. 숨긴 내용을 다시 공개하지 않도록 건너뛴다.
 * - conflict: 대상의 편집 뒤에 다른 사람이 편집했다.
 * - deleted: 이미 삭제된 문서다.
 */
export type BulkRevertStatus =
  "revert" | "delete" | "same" | "clean" | "hidden" | "conflict" | "deleted";

export interface BulkRevertRow {
  pageId: number;
  pageTitle: string;
  currentRevisionId: number;
  restoreRevisionId: number | null;
  /** 되돌리면 걷어 낼 대상의 편집 수. 충돌이나 삭제된 문서면 이 문서에서 대상이 쓴 판 전부. */
  editCount: number;
  /**
   * 되돌려도 남는 대상의 편집 수. 대상의 편집 사이에 다른 사람의 판이 끼어 있으면, 돌아갈 판에 대상의
   * 앞선 편집이 들어 있다.
   */
  keptCount: number;
  /** 걷어 낼 편집에 이동이 있다. 이 기능은 본문만 되돌리고 제목은 그대로 둔다. */
  hasMove: boolean;
  /** 대상의 이동이 옛 이름에 남긴 넘겨주기. */
  moveLeftover: boolean;
  status: BulkRevertStatus;
}

export type BulkRevertOutcome = "reverted" | "deleted" | "skipped";

/** 고를 수 있는 줄. 할 일이 없거나 건너뛸 줄은 고를 수 없다. */
export function isSelectable(row: BulkRevertRow): boolean {
  return row.status === "revert" || row.status === "delete";
}

/**
 * 처음에 고른 상태인가. 이동이 남긴 넘겨주기는 고르지 않는다. 지워도 되지만, 관리자가 옮겨진 문서를
 * 옛 이름으로 다시 옮기면 그 이동이 넘겨주기를 덮어쓰므로 따로 지울 일이 드물다.
 */
export function isSelectedByDefault(row: BulkRevertRow): boolean {
  return isSelectable(row) && !row.moveLeftover;
}

/** 이 줄의 칸이 골라져 있나. `overrides`는 관리자가 바꾼 칸이다(문서 id → 고름). */
export function isChecked(
  row: BulkRevertRow,
  overrides: ReadonlyMap<number, boolean>,
): boolean {
  return (
    isSelectable(row) && (overrides.get(row.pageId) ?? isSelectedByDefault(row))
  );
}

/** 지금 고른 줄. */
export function selectedRows(
  rows: readonly BulkRevertRow[],
  overrides: ReadonlyMap<number, boolean>,
): BulkRevertRow[] {
  return rows.filter((row) => isChecked(row, overrides));
}

/**
 * `since`(밀리초) 뒤에 쓴 편집 가운데 가장 앞선 판. 그 판이 시작점이 된다. 그런 편집이 없으면
 * `null`. 편집은 최신순이어도 되고 순서가 없어도 된다.
 */
export function firstEditSince(
  edits: readonly { id: number; createdAt: string }[],
  since: number,
): number | null {
  let first: number | null = null;
  for (const edit of edits) {
    if (new Date(edit.createdAt).getTime() < since) continue;
    if (first === null || edit.id < first) first = edit.id;
  }
  return first;
}

/** 결과 한 줄 요약. */
export function describeBulkRevertResult(
  outcomes: readonly BulkRevertOutcome[],
  sent: number,
): string {
  const reverted = outcomes.filter((outcome) => outcome === "reverted").length;
  const deleted = outcomes.filter((outcome) => outcome === "deleted").length;
  const skipped = sent - reverted - deleted;
  const parts = [`되돌림 ${reverted}개`, `삭제 ${deleted}개`];
  if (skipped > 0) parts.push(`건너뜀 ${skipped}개(그사이 바뀐 문서)`);
  return parts.join(", ");
}

/**
 * 일괄 되돌리기 화면 주소. `sourceRevisionId`는 조회의 근거 판이다. 허가가 끝나면 이 판에서 다시
 * 조회한다. `fromRevisionId`가 없으면 대상의 모든 편집이다.
 */
export function bulkRevertHref(
  lookupId: string,
  sourceRevisionId: number,
  fromRevisionId?: number | null,
): string {
  const params = new URLSearchParams({
    src: String(sourceRevisionId),
    lookup: lookupId,
  });
  if (fromRevisionId != null) params.set("from", String(fromRevisionId));
  return `/admin/bulk-revert?${params.toString()}`;
}
