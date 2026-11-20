import { describe, expect, it } from "vitest";

import {
  banEndsAt,
  CUSTOM_PRESET,
  describeBanLength,
  parseBanLength,
} from "~/features/admin/model/ban-length";

describe("parseBanLength", () => {
  it("reads a preset", () => {
    expect(parseBanLength({ preset: "1h", amount: "", unit: "day" })).toEqual({
      amount: 1,
      unit: "hour",
    });
    expect(
      parseBanLength({ preset: "forever", amount: "", unit: "day" }),
    ).toBeNull();
  });

  it("reads a custom amount and unit", () => {
    expect(
      parseBanLength({ preset: CUSTOM_PRESET, amount: " 2 ", unit: "week" }),
    ).toEqual({ amount: 2, unit: "week" });
  });

  it("rejects empty, zero, fractional and too long custom values", () => {
    for (const amount of ["", "0", "1.5", "-3", "abc"]) {
      expect(
        parseBanLength({ preset: CUSTOM_PRESET, amount, unit: "day" }),
      ).toBeUndefined();
    }
    expect(
      parseBanLength({ preset: CUSTOM_PRESET, amount: "120", unit: "month" }),
    ).toBeUndefined();
    expect(
      parseBanLength({ preset: CUSTOM_PRESET, amount: "119", unit: "month" }),
    ).toEqual({ amount: 119, unit: "month" });
  });

  it("rejects an unknown preset", () => {
    expect(
      parseBanLength({ preset: "nope", amount: "", unit: "day" }),
    ).toBeUndefined();
  });
});

describe("banEndsAt", () => {
  const now = Date.UTC(2026, 0, 31, 3, 0);

  it("returns null for an indefinite ban", () => {
    expect(banEndsAt(null, now)).toBeNull();
  });

  it("adds hours, days and weeks", () => {
    expect(banEndsAt({ amount: 5, unit: "hour" }, now)).toBe(
      "2026-01-31T08:00:00.000Z",
    );
    expect(banEndsAt({ amount: 1, unit: "day" }, now)).toBe(
      "2026-02-01T03:00:00.000Z",
    );
    expect(banEndsAt({ amount: 2, unit: "week" }, now)).toBe(
      "2026-02-14T03:00:00.000Z",
    );
  });

  it("adds calendar months, clamped to the end of a short month", () => {
    expect(banEndsAt({ amount: 1, unit: "month" }, now)?.slice(0, 10)).toBe(
      "2026-02-28",
    );
    expect(banEndsAt({ amount: 3, unit: "month" }, now)?.slice(0, 10)).toBe(
      "2026-04-30",
    );
  });
});

describe("describeBanLength", () => {
  it("names the length", () => {
    expect(describeBanLength({ amount: 3, unit: "day" })).toBe("3일");
    expect(describeBanLength({ amount: 1, unit: "month" })).toBe("1개월");
    expect(describeBanLength(null)).toBe("기한 없음");
  });
});
