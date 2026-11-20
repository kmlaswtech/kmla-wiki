import { describe, expect, it } from "vitest";

import {
  bulkRevertHref,
  describeBulkRevertResult,
  firstEditSince,
  isSelectable,
  isSelectedByDefault,
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
