import { describe, expect, it } from "vitest";

import { describeBanHistory } from "~/features/admin/model/ban-history";

describe("describeBanHistory", () => {
  it("says there is no previous ban", () => {
    expect(describeBanHistory({ total: 0, lifted: 0, active: false })).toBe(
      "이전 차단 없음",
    );
  });

  it("counts previous bans and lifted ones apart", () => {
    expect(describeBanHistory({ total: 2, lifted: 0, active: false })).toBe(
      "이전 차단 2회",
    );
    expect(describeBanHistory({ total: 3, lifted: 1, active: false })).toBe(
      "이전 차단 3회 (그중 해제 1회)",
    );
  });

  it("puts a ban in progress first", () => {
    expect(describeBanHistory({ total: 1, lifted: 0, active: true })).toBe(
      "지금 차단 중 · 이전 차단 1회",
    );
  });
});
