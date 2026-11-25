import { describe, expect, it } from "vitest";

import {
  canWithdrawDiscussion,
  canWithdrawPost,
  closeState,
  formatRemaining,
  postLength,
  sortDiscussions,
} from "~/features/discussions/model/rules";
import type {
  Discussion,
  DiscussionPost,
} from "~/features/discussions/model/types";

function post(overrides: Partial<DiscussionPost>): DiscussionPost {
  return {
    id: 1,
    kind: "post",
    authorName: "익명#000001",
    asAdmin: false,
    state: "visible",
    body: "글",
    createdAt: "2026-11-25T00:00:00Z",
    mine: false,
    ...overrides,
  };
}

function discussion(overrides: Partial<Discussion>): Discussion {
  return {
    id: 1,
    pageId: 1,
    pageTitle: "문서",
    title: "토론",
    revisionId: null,
    isOpen: true,
    createdAt: "2026-11-25T00:00:00Z",
    closedAt: null,
    closeAfter: "2026-11-26T00:00:00Z",
    openedByMe: false,
    createdByMe: false,
    deleted: false,
    posts: [post({ id: 1, kind: "open" })],
    ...overrides,
  };
}

const HOUR = 3_600_000;

describe("closeState", () => {
  const before = new Date("2026-11-25T12:00:00Z").getTime();

  it("waits until 24 hours have passed", () => {
    expect(closeState(discussion({}), before)).toEqual({
      kind: "wait",
      until: "2026-11-26T00:00:00Z",
    });
  });

  it("allows closing after the wait", () => {
    expect(closeState(discussion({}), before + 12 * HOUR).kind).toBe("allowed");
  });

  it("lets the member who opened this round close at any time", () => {
    expect(closeState(discussion({ openedByMe: true }), before).kind).toBe(
      "allowed",
    );
  });
});

describe("formatRemaining", () => {
  const now = new Date("2026-11-25T00:00:00Z").getTime();
  it("shows hours and minutes, rounding up", () => {
    expect(formatRemaining("2026-11-25T03:20:00Z", now)).toBe("3시간 20분");
    expect(formatRemaining("2026-11-25T02:00:00Z", now)).toBe("2시간");
    expect(formatRemaining("2026-11-25T00:00:30Z", now)).toBe("1분");
  });
});

describe("canWithdrawPost", () => {
  const mine = post({ id: 2, mine: true });

  it("allows my last post", () => {
    expect(canWithdrawPost([post({ id: 1, kind: "open" }), mine], mine)).toBe(
      true,
    );
  });

  it("refuses when a reply follows, unless it was withdrawn", () => {
    expect(canWithdrawPost([mine, post({ id: 3 })], mine)).toBe(false);
    expect(
      canWithdrawPost([mine, post({ id: 3, state: "withdrawn" })], mine),
    ).toBe(true);
  });

  it("refuses posts of others and the opening, close and reopen posts", () => {
    const other = post({ id: 2 });
    expect(canWithdrawPost([other], other)).toBe(false);
    for (const kind of ["open", "close", "reopen"] as const) {
      const special = post({ id: 2, mine: true, kind });
      expect(canWithdrawPost([special], special)).toBe(false);
    }
  });
});

describe("canWithdrawDiscussion", () => {
  it("allows the opener when only the opening post is left", () => {
    expect(
      canWithdrawDiscussion(
        discussion({
          createdByMe: true,
          posts: [
            post({ id: 1, kind: "open" }),
            post({ id: 2, state: "withdrawn" }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it("refuses with a reply or for another member", () => {
    expect(
      canWithdrawDiscussion(
        discussion({
          createdByMe: true,
          posts: [post({ id: 1, kind: "open" }), post({ id: 2 })],
        }),
      ),
    ).toBe(false);
    expect(canWithdrawDiscussion(discussion({}))).toBe(false);
  });
});

describe("sortDiscussions", () => {
  const rows = [
    { id: 1, isOpen: false },
    { id: 2, isOpen: true },
    { id: 3, isOpen: false },
    { id: 4, isOpen: true },
  ];
  it("keeps the server order for recent activity", () => {
    expect(sortDiscussions(rows, "recent").map((row) => row.id)).toEqual([
      1, 2, 3, 4,
    ]);
  });
  it("moves open discussions first and keeps the order inside each group", () => {
    expect(sortDiscussions(rows, "open-first").map((row) => row.id)).toEqual([
      2, 4, 1, 3,
    ]);
  });
});

describe("postLength", () => {
  it("counts like the server: trimmed, CRLF as one break", () => {
    expect(postLength("  가\r\n나  ")).toBe(3);
  });
});
