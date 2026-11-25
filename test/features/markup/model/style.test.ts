import { describe, expect, it } from "vitest";

import {
  backgroundVars,
  cellVAlignOf,
  contrastRatio,
  formatCustomColor,
  normalizeHex,
  paletteTextShift,
  parseBackground,
  parseTextColor,
  readableOn,
  textColorVars,
} from "~/features/markup/model/style";

describe("colors", () => {
  it("reads palette names and checked hex values only", () => {
    expect(parseTextColor("red")).toEqual({ kind: "palette", hue: "red" });
    expect(parseTextColor("#112233")).toEqual({
      kind: "custom",
      light: "#112233",
      dark: null,
    });
    expect(parseTextColor("#112233,#ddeeff")).toEqual({
      kind: "custom",
      light: "#112233",
      dark: "#ddeeff",
    });
    for (const bad of [
      "crimson",
      "#12345",
      "#112233,",
      "#112233,#ddeeff,#000000",
      "red; background: url(x)",
      "#112233;x",
      null,
      3,
    ]) {
      expect(parseTextColor(bad)).toBeNull();
    }
  });

  it("reads soft and strong palette backgrounds", () => {
    expect(parseBackground("blue")).toEqual({
      kind: "palette",
      hue: "blue",
      strong: false,
    });
    expect(parseBackground("blue-strong")).toEqual({
      kind: "palette",
      hue: "blue",
      strong: true,
    });
    expect(parseBackground("navy-strong")).toBeNull();
  });

  it("normalizes typed hex values", () => {
    expect(normalizeHex(" #ABC ")).toBe("#aabbcc");
    expect(normalizeHex("336699")).toBe("#336699");
    expect(normalizeHex("#33669")).toBeNull();
    expect(formatCustomColor({ light: "#111111", dark: null })).toBe("#111111");
    expect(formatCustomColor({ light: "#111111", dark: "#111111" })).toBe(
      "#111111",
    );
    expect(formatCustomColor({ light: "#111111", dark: "#eeeeee" })).toBe(
      "#111111,#eeeeee",
    );
  });

  it("always sets both theme variables, so nothing leaks from a parent", () => {
    expect(textColorVars({ kind: "palette", hue: "red" })).toEqual({
      "--wiki-fg": "var(--wiki-cell-text-red, #b71824)",
      "--wiki-fg-dark": "var(--wiki-cell-text-red-dark, #ff9189)",
    });
    expect(
      textColorVars({ kind: "custom", light: "#111111", dark: null }),
    ).toEqual({ "--wiki-fg": "#111111", "--wiki-fg-dark": "#111111" });
  });

  it("picks readable text on a custom background", () => {
    const { vars, strong } = backgroundVars({
      kind: "custom",
      light: "#ffee88",
      dark: "#202040",
    });
    expect(strong).toBe(true);
    expect(vars["--wiki-on"]).toBe("#1f2023");
    expect(vars["--wiki-on-dark"]).toBe("#ffffff");
  });

  it("uses adjusted palette text colors on a strong background", () => {
    const { vars } = backgroundVars({
      kind: "palette",
      hue: "red",
      strong: true,
    });
    const text = vars["--wiki-cell-text-red"];
    expect(text).not.toBe("#b71824");
    expect(text).not.toBe(readableOn("#b71824"));
    expect(contrastRatio(text ?? "", "#b71824")).toBeGreaterThanOrEqual(4.5);
  });

  it("tells which screen mode shifts a palette text color", () => {
    expect(
      paletteTextShift("red", { kind: "palette", hue: "red", strong: true }),
    ).toEqual({ light: "lighter", dark: "lighter" });
    expect(
      paletteTextShift("red", { kind: "palette", hue: "red", strong: false }),
    ).toEqual({ light: null, dark: null });
    expect(
      paletteTextShift("blue", {
        kind: "custom",
        light: "#ffffff",
        dark: "#0060c1",
      }),
    ).toEqual({ light: null, dark: "lighter" });
    expect(
      paletteTextShift("blue", {
        kind: "custom",
        light: "#0060c1",
        dark: "#18191a",
      }),
    ).toEqual({ light: "lighter", dark: null });
  });

  it("picks readable text on a palette fill", () => {
    expect(readableOn("#0060c1")).toBe("#ffffff");
  });
});

describe("cell vertical alignment", () => {
  it("reads middle and bottom; anything else is the default top", () => {
    const cell = (verticalAlign: unknown) => ({
      type: "tableCell",
      attrs: { verticalAlign },
    });
    expect(cellVAlignOf(cell("middle"))).toBe("middle");
    expect(cellVAlignOf(cell("bottom"))).toBe("bottom");
    for (const other of ["top", "baseline", "middle; color: red", null, 1]) {
      expect(cellVAlignOf(cell(other))).toBeNull();
    }
    expect(cellVAlignOf({ type: "tableCell" })).toBeNull();
  });
});
