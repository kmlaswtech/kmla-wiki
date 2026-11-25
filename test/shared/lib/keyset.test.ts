import { describe, expect, it } from "vitest";

import {
  keysetHrefs,
  keysetPage,
  keysetQuery,
  readPageCursor,
  type PageCursor,
} from "~/shared/lib/keyset";

interface FakeQuery {
  order(column: "id", options: { ascending: boolean }): FakeQuery;
  limit(count: number): FakeQuery;
  lt(column: "id", value: number): FakeQuery;
  gt(column: "id", value: number): FakeQuery;
}

/** 번호 1..total의 행에서 `keysetQuery`가 읽는 행. 조건을 모았다가 PostgREST처럼 거르고 자른다. */
function fetch(total: number, cursor: PageCursor, size: number) {
  const spec = { ascending: true, limit: total, lt: Infinity, gt: 0 };
  const query: FakeQuery = {
    order: (_, { ascending }) => ((spec.ascending = ascending), query),
    limit: (count) => ((spec.limit = count), query),
    lt: (_, value) => ((spec.lt = value), query),
    gt: (_, value) => ((spec.gt = value), query),
  };
  keysetQuery(query, cursor, size);
  const ids = Array.from({ length: total }, (_, index) => index + 1).filter(
    (id) => id > spec.gt && id < spec.lt,
  );
  if (!spec.ascending) ids.reverse();
  return ids.slice(0, spec.limit).map((id) => ({ id }));
}

function page(total: number, cursor: PageCursor, size = 3) {
  const result = keysetPage(fetch(total, cursor, size), cursor, size);
  return { ...result, items: result.items.map((row) => row.id) };
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
      atStart: true,
    });
  });

  it("has no older page when the rows end", () => {
    expect(page(3, { kind: "first" })).toMatchObject({
      items: [3, 2, 1],
      older: null,
    });
    expect(page(7, { kind: "before", id: 2 })).toEqual({
      items: [1],
      newer: 1,
      older: null,
      atStart: false,
    });
  });

  it("goes back to the same page it came from", () => {
    const second = page(7, { kind: "before", id: 5 });
    expect(second).toEqual({
      items: [4, 3, 2],
      newer: 4,
      older: 2,
      atStart: false,
    });
    expect(page(7, { kind: "after", id: second.newer! })).toEqual({
      items: [7, 6, 5],
      newer: null,
      older: 5,
      atStart: true,
    });
  });

  it("shows a newer page when there are more rows after the cursor", () => {
    expect(page(9, { kind: "after", id: 2 })).toEqual({
      items: [5, 4, 3],
      newer: 5,
      older: 3,
      atStart: false,
    });
  });

  it("only goes back to the start from an empty page", () => {
    for (const cursor of [
      { kind: "before", id: 1 },
      { kind: "after", id: 7 },
    ] as const) {
      expect(page(7, cursor)).toEqual({
        items: [],
        newer: null,
        older: null,
        atStart: false,
      });
    }
  });
});

describe("keysetHrefs", () => {
  it("links each side and the start only when there is one", () => {
    expect(
      keysetHrefs("/recent", { newer: 4, older: 2, atStart: false }),
    ).toEqual({
      first: "/recent",
      prev: "/recent?after=4",
      next: "/recent?before=2",
    });
    expect(
      keysetHrefs("/recent", { newer: null, older: null, atStart: true }),
    ).toEqual({ first: null, prev: null, next: null });
  });
});
