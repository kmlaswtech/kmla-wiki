import { describe, expect, it } from "vitest";

import {
  BULK_REVERT_MAX,
  bulkRevertHref,
  clearSelection,
  describeBulkRevertResult,
  firstEditSince,
  isSelectable,
  isSelectedByDefault,
  markProcessed,
  selectedRows,
  type BulkRevertRow,
} from "~/features/admin/model/bulk-revert";

function row(
  pageId: number,
  status: BulkRevertRow["status"],
  extra: Partial<BulkRevertRow> = {},
): BulkRevertRow {
  return {
    pageId,
    pageTitle: `문서 ${pageId}`,
    currentRevisionId: pageId * 10,
    restoreRevisionId: status === "delete" ? null : pageId * 10 - 1,
    editCount: 1,
    keptCount: 0,
    hasMove: false,
    moveLeftover: false,
    status,
    ...extra,
  };
}

describe("selection", () => {
  it("only reverts and deletes can be chosen", () => {
    expect(isSelectable(row(1, "revert"))).toBe(true);
    expect(isSelectable(row(2, "delete"))).toBe(true);
    expect(isSelectable(row(3, "same"))).toBe(false);
    expect(isSelectable(row(6, "hidden"))).toBe(false);
    expect(isSelectable(row(7, "clean"))).toBe(false);
    expect(isSelectable(row(4, "conflict"))).toBe(false);
    expect(isSelectable(row(5, "deleted"))).toBe(false);
  });

  it("leaves a redirect left by a move unchosen at first", () => {
    expect(isSelectedByDefault(row(1, "delete"))).toBe(true);
    expect(isSelectedByDefault(row(2, "delete", { moveLeftover: true }))).toBe(
      false,
    );
  });

  it("applies the admin's choices on top of the defaults", () => {
    const rows = [
      row(1, "revert"),
      row(2, "delete", { moveLeftover: true }),
      row(3, "conflict"),
    ];
    expect(selectedRows(rows, new Map()).map((r) => r.pageId)).toEqual([1]);
    expect(
      selectedRows(
        rows,
        new Map([
          [1, false],
          [2, true],
          [3, true],
        ]),
      ).map((r) => r.pageId),
    ).toEqual([2]);
  });

  it("chooses at most the limit by default, from the top", () => {
    const rows = Array.from({ length: BULK_REVERT_MAX + 5 }, (_, i) =>
      row(i + 1, "revert"),
    );
    const ids = selectedRows(rows, new Map()).map((r) => r.pageId);
    expect(ids).toHaveLength(BULK_REVERT_MAX);
    expect(ids.at(-1)).toBe(BULK_REVERT_MAX);
    // 위의 줄이 빠지면(처리함) 다음 줄이 골라진다.
    expect(
      selectedRows(rows.slice(5), new Map())
        .map((r) => r.pageId)
        .at(-1),
    ).toBe(BULK_REVERT_MAX + 5);
  });

  it("clears every choosable row", () => {
    const rows = [row(1, "revert"), row(2, "delete"), row(3, "conflict")];
    expect(selectedRows(rows, clearSelection(rows))).toEqual([]);
  });
});

describe("markProcessed", () => {
  it("shows what this screen just did instead of the re-read status", () => {
    const rows = [
      row(1, "conflict", { keptCount: 1 }),
      row(2, "deleted"),
      row(3, "revert"),
      row(4, "clean"),
    ];
    const marked = markProcessed(
      rows,
      new Map([
        [1, "reverted"],
        [2, "deleted"],
        [3, "reverted"],
      ] as const),
    );
    expect(marked.map((r) => r.status)).toEqual([
      "reverted",
      "deleted",
      // 대상이 그 뒤 다시 편집해 되돌릴 일이 생겼으면 그대로 둔다.
      "revert",
      "clean",
    ]);
    expect(isSelectable(marked[0]!)).toBe(false);
  });
});

describe("firstEditSince", () => {
  const edits = [
    { id: 30, createdAt: "2026-11-20T10:30:00Z" },
    { id: 20, createdAt: "2026-11-20T10:00:00Z" },
    { id: 10, createdAt: "2026-11-20T09:00:00Z" },
  ];

  it("picks the earliest edit at or after the time", () => {
    expect(firstEditSince(edits, Date.parse("2026-11-20T10:00:00Z"))).toBe(20);
    expect(firstEditSince(edits, Date.parse("2026-11-20T08:00:00Z"))).toBe(10);
  });

  it("returns null when nothing is that recent", () => {
    expect(firstEditSince(edits, Date.parse("2026-11-20T11:00:00Z"))).toBe(
      null,
    );
  });
});

describe("describeBulkRevertResult", () => {
  it("counts what was skipped as the rest of what was sent", () => {
    expect(
      describeBulkRevertResult(["reverted", "deleted", "skipped"], 4),
    ).toBe("되돌림 1개, 삭제 1개, 건너뜀 2개(그사이 바뀐 문서)");
    expect(describeBulkRevertResult(["reverted"], 1)).toBe(
      "되돌림 1개, 삭제 0개",
    );
  });
});

describe("bulkRevertHref", () => {
  it("carries the lookup, its source, and an optional start", () => {
    expect(bulkRevertHref("abc", 5)).toBe(
      "/admin/bulk-revert?src=5&lookup=abc",
    );
    expect(bulkRevertHref("abc", 5, 7)).toBe(
      "/admin/bulk-revert?src=5&lookup=abc&from=7",
    );
  });
});
