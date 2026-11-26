import { describe, expect, it } from "vitest";

import {
  banInterval,
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

  it("rejects empty, zero, fractional and absurd custom values", () => {
    for (const amount of ["", "0", "1.5", "-3", "abc", "1234567"]) {
      expect(
        parseBanLength({ preset: CUSTOM_PRESET, amount, unit: "day" }),
      ).toBeUndefined();
    }
  });

  it("rejects an unknown preset", () => {
    expect(
      parseBanLength({ preset: "nope", amount: "", unit: "day" }),
    ).toBeUndefined();
  });
});

describe("banInterval", () => {
  it("writes a Postgres interval, or null for an indefinite ban", () => {
    expect(banInterval({ amount: 3, unit: "day" })).toBe("3 day");
    expect(banInterval({ amount: 2, unit: "month" })).toBe("2 month");
    expect(banInterval(null)).toBeNull();
  });
});

describe("describeBanLength", () => {
  it("names the length", () => {
    expect(describeBanLength({ amount: 3, unit: "day" })).toBe("3일");
    expect(describeBanLength({ amount: 1, unit: "month" })).toBe("1개월");
    expect(describeBanLength(null)).toBe("기한 없음");
  });
});
