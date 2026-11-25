import { describe, expect, it } from "vitest";

import { adjustForContrast, contrastRatio } from "~/shared/lib/color";

describe("color", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1);
  });

  it("moves only the lightness of a text color until it is readable", () => {
    // 진한 빨강 배경 위의 빨강 글자는 검정이 아니라 더 밝은 빨강이 된다.
    const adjusted = adjustForContrast("#b71824", "#b71824");
    expect(contrastRatio(adjusted, "#b71824")).toBeGreaterThanOrEqual(4.5);
    const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) =>
      Number.parseInt(adjusted.slice(i, i + 2), 16),
    );
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    // 이미 읽히면 그대로 둔다.
    expect(adjustForContrast("#b71824", "#ffffff")).toBe("#b71824");
  });

  it("always finds a readable color, even on a mid gray", () => {
    for (const background of ["#777777", "#808080", "#767676"]) {
      const adjusted = adjustForContrast("#777777", background);
      expect(contrastRatio(adjusted, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
