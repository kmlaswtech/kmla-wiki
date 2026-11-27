import { describe, expect, it } from "vitest";

import {
  filterPresets,
  isPresetTitle,
  presetEditHref,
  presetLabel,
  suggestPresets,
  type Preset,
} from "~/features/presets/model/presets";

const preset = (title: string, ...categoryKeys: string[]): Preset => ({
  title,
  categoryKeys,
});

const PRESETS = [
  preset("위키:템플릿/귀가", "분류:귀가"),
  preset("위키:템플릿/귀가/정기 귀가"),
  preset("위키:템플릿/귀가 신청서", "분류:귀가"),
  preset("위키:템플릿/동아리", "분류:동아리"),
  preset("위키:템플릿/로봇부", "분류:동아리"),
];

describe("suggestPresets", () => {
  it("matches ancestor paths, nearest first", () => {
    expect(suggestPresets("귀가/정기 귀가/신청", PRESETS, [])).toEqual([
      "위키:템플릿/귀가/정기 귀가",
      "위키:템플릿/귀가",
    ]);
  });

  it("does not match the page's own title", () => {
    expect(suggestPresets("귀가", PRESETS, [])).toEqual([]);
    expect(suggestPresets("귀가/정기 귀가", PRESETS, [])).toEqual([
      "위키:템플릿/귀가",
    ]);
  });

  it("adds presets that share a category, after path matches", () => {
    expect(suggestPresets("귀가/특별 귀가", PRESETS, ["분류:귀가"])).toEqual([
      "위키:템플릿/귀가",
      "위키:템플릿/귀가 신청서",
    ]);
  });

  it("finds presets by category without a path", () => {
    expect(suggestPresets("정기 귀가", PRESETS, ["분류:동아리"])).toEqual([
      "위키:템플릿/동아리",
      "위키:템플릿/로봇부",
    ]);
  });

  it("keeps at most three suggestions", () => {
    expect(
      suggestPresets("귀가/정기 귀가/신청", PRESETS, [
        "분류:귀가",
        "분류:동아리",
      ]),
    ).toEqual([
      "위키:템플릿/귀가/정기 귀가",
      "위키:템플릿/귀가",
      "위키:템플릿/귀가 신청서",
    ]);
  });

  it("ignores letter case in paths", () => {
    expect(suggestPresets("Club/A", [preset("위키:템플릿/club")], [])).toEqual([
      "위키:템플릿/club",
    ]);
  });

  it("does not suggest for a preset page itself", () => {
    expect(
      suggestPresets("위키:템플릿/귀가/새 템플릿", PRESETS, ["분류:귀가"]),
    ).toEqual([]);
  });
});

describe("filterPresets", () => {
  it("keeps presets whose label contains the query", () => {
    expect(filterPresets(PRESETS, "신청").map((item) => item.title)).toEqual([
      "위키:템플릿/귀가 신청서",
    ]);
    expect(filterPresets(PRESETS, "  ")).toHaveLength(PRESETS.length);
  });

  it("does not search the prefix", () => {
    expect(filterPresets(PRESETS, "템플릿")).toEqual([]);
  });
});

describe("preset titles", () => {
  it("only treats pages under the prefix as presets", () => {
    expect(isPresetTitle("위키:템플릿/귀가")).toBe(true);
    expect(isPresetTitle("위키:템플릿")).toBe(false);
    expect(isPresetTitle("귀가")).toBe(false);
  });

  it("drops the prefix for the label", () => {
    expect(presetLabel("위키:템플릿/귀가/정기 귀가")).toBe("귀가/정기 귀가");
  });

  it("puts the preset in the edit address", () => {
    const href = presetEditHref("귀가/정기 귀가", "위키:템플릿/귀가");
    const url = new URL(href, "https://wiki.test");
    expect(url.pathname).toBe(
      `/edit/${encodeURIComponent("귀가")}/${encodeURIComponent("정기_귀가")}`,
    );
    expect(url.searchParams.get("preset")).toBe("위키:템플릿/귀가");
  });
});
