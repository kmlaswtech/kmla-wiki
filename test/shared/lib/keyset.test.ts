import { describe, expect, it } from "vitest";

import {
  keysetHrefs,
  keysetPage,
  keysetRange,
  readPageCursor,
  type PageCursor,
} from "~/shared/lib/keyset";

/** 번호 1..total의 행에서 커서가 읽는 행. DB의 `keysetRange` 조회를 흉내 낸다. */
function fetch(total: number, cursor: PageCursor, size: number): number[] {
  const range = keysetRange(cursor, size);
  const ids = Array.from({ length: total }, (_, index) => index + 1).filter(
    (id) =>
      (range.lt === undefined || id < range.lt) &&
      (range.gt === undefined || id > range.gt),
  );
  if (!range.ascending) ids.reverse();
  return ids.slice(0, range.limit);
}

function page(total: number, cursor: PageCursor, size = 3) {
  return keysetPage(fetch(total, cursor, size), cursor, size, (id) => id);
}

describe("readPageCursor", () => {
  it("reads before, then after, and ignores bad values", () => {
    expect(readPageCursor(new URLSearchParams("before=5&after=2"))).toEqual({
      kind: "before",
      id: 5,
    });
    expect(readPageCursor(new URLSearchParams("after=2"))).toEqual({
      kind: "after",
      id: 2,
    });
    expect(readPageCursor(new URLSearchParams("before=0&after=x"))).toEqual({
      kind: "first",
    });
  });
});

describe("keysetPage", () => {
  it("gives the newest rows first with only an older page", () => {
    expect(page(7, { kind: "first" })).toEqual({
      items: [7, 6, 5],
      newer: null,
      older: 5,
    });
  });

  it("has no older page when the rows end", () => {
    expect(page(3, { kind: "first" })).toEqual({
      items: [3, 2, 1],
      newer: null,
      older: null,
    });
    expect(page(7, { kind: "before", id: 2 })).toEqual({
      items: [1],
      newer: 1,
      older: null,
    });
  });

  it("goes back to the same page it came from", () => {
    const second = page(7, { kind: "before", id: 5 });
    expect(second).toEqual({ items: [4, 3, 2], newer: 4, older: 2 });
    const back = page(7, { kind: "after", id: second.newer! });
    expect(back).toEqual({ items: [7, 6, 5], newer: null, older: 5 });
  });

  it("shows a newer page when there are more rows after the cursor", () => {
    expect(page(9, { kind: "after", id: 2 })).toEqual({
      items: [5, 4, 3],
      newer: 5,
      older: 3,
    });
  });

  it("links back next to the cursor when a page is empty", () => {
    expect(page(7, { kind: "before", id: 1 })).toEqual({
      items: [],
      newer: 0,
      older: null,
    });
    expect(page(7, { kind: "after", id: 7 })).toEqual({
      items: [],
      newer: null,
      older: 8,
    });
  });
});

describe("keysetHrefs", () => {
  it("builds both links and drops a cursor that cannot exist", () => {
    expect(keysetHrefs("/recent", { newer: 4, older: 2 })).toEqual({
      newer: "/recent?after=4",
      older: "/recent?before=2",
    });
    expect(keysetHrefs("/recent", { newer: 0, older: null })).toEqual({
      newer: null,
      older: null,
    });
  });
});
