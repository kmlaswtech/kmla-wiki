import { describe, expect, it } from "vitest";

import {
  contrastNotice,
  customTextWarnings,
  shiftMessage,
} from "~/features/editor/model/contrast-notice";
import type { CellBackground } from "~/features/markup";

const strongRed: CellBackground = {
  kind: "palette",
  hue: "red",
  strong: true,
};
const softRed: CellBackground = { kind: "palette", hue: "red", strong: false };
/** 밝은 화면은 흰색, 어두운 화면은 파랑. 어두운 화면에서만 파랑 글자가 보정된다. */
const blueAtNight: CellBackground = {
  kind: "custom",
  light: "#ffffff",
  dark: "#0060c1",
};

describe("shiftMessage", () => {
  it("names the screen mode only when one mode shifts", () => {
    expect(shiftMessage({ light: "lighter", dark: "lighter" })).toBe(
      "대비가 모자라 색 보정을 합니다.",
    );
    expect(shiftMessage({ light: null, dark: "lighter" })).toBe(
      "어두운 화면에서 대비가 모자라 조금 밝게 보입니다.",
    );
    expect(shiftMessage({ light: "darker", dark: null })).toBe(
      "밝은 화면에서 대비가 모자라 조금 어둡게 보입니다.",
    );
    expect(shiftMessage({ light: null, dark: null })).toBeNull();
  });
});

describe("contrastNotice", () => {
  it("warns about a palette text color on the background behind it", () => {
    expect(contrastNotice("text", "red", [strongRed], [])).toEqual([
      "대비가 모자라 색 보정을 합니다.",
    ]);
    expect(contrastNotice("text", "blue", [blueAtNight], [])).toEqual([
      "어두운 화면에서 대비가 모자라 조금 밝게 보입니다.",
    ]);
    expect(contrastNotice("text", "red", [softRed], [])).toBeNull();
    expect(contrastNotice("text", "red", [], [])).toBeNull();
    // 직접 넣은 글자 색은 보정하지 않으므로 이 알림이 없다.
    expect(contrastNotice("text", "#b71824", [strongRed], [])).toBeNull();
  });

  it("warns when any of several selected backgrounds shifts the color", () => {
    expect(contrastNotice("text", "red", [softRed, strongRed], [])).toEqual([
      "대비가 모자라 색 보정을 합니다.",
    ]);
  });

  it("names each text color a background would shift", () => {
    expect(
      contrastNotice("background", "red-strong", [], ["red", "blue"]),
    ).toEqual([
      "빨강 글자: 대비가 모자라 색 보정을 합니다.",
      "파랑 글자: 대비가 모자라 색 보정을 합니다.",
    ]);
    expect(contrastNotice("background", "red", [], ["red"])).toBeNull();
  });
});

describe("customTextWarnings", () => {
  it("checks a typed color against the worst background behind it", () => {
    expect(customTextWarnings("#c01020", null, [null])).toEqual([
      "어두운 화면에서 읽기 어렵습니다(대비 2.8:1).",
    ]);
    expect(customTextWarnings("#c01020", null, [null, strongRed])).toEqual([
      "밝은 화면에서 읽기 어렵습니다(대비 1.1:1).",
      "어두운 화면에서 읽기 어렵습니다(대비 1.1:1).",
    ]);
    expect(customTextWarnings("#c01020", "#ffd0d0", [])).toEqual([]);
  });
});
