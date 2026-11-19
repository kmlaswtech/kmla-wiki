import { describe, expect, it } from "vitest";

import {
  sectionCandidates,
  sectionExists,
} from "~/features/editor/model/section-link";

const headings = [
  { text: "신청 방법", id: "신청-방법" },
  { text: "주의", id: "주의" },
  { text: "주의", id: "주의-2" },
  { text: "FAQ", id: "FAQ" },
];

describe("sectionCandidates", () => {
  it("비었으면 모든 문단을 보이고, 같은 이름의 둘째부터는 id를 넣는다", () => {
    expect(sectionCandidates(headings, "")).toEqual([
      { label: "신청 방법", value: "신청 방법" },
      { label: "주의", value: "주의" },
      { label: "주의 (주의-2)", value: "주의-2" },
      { label: "FAQ", value: "FAQ" },
    ]);
  });

  it("글자나 id로 거른다(대소문자 무시)", () => {
    expect(sectionCandidates(headings, "신청").map((c) => c.value)).toEqual([
      "신청 방법",
    ]);
    expect(sectionCandidates(headings, "신청-방").map((c) => c.value)).toEqual([
      "신청 방법",
    ]);
    expect(sectionCandidates(headings, "faq").map((c) => c.value)).toEqual([
      "FAQ",
    ]);
  });
});

describe("sectionExists", () => {
  it("링크와 같은 규칙으로 id를 맞춘다", () => {
    expect(sectionExists(headings, "신청 방법")).toBe(true);
    expect(sectionExists(headings, " 신청   방법 ")).toBe(true);
    expect(sectionExists(headings, "주의-2")).toBe(true);
    expect(sectionExists(headings, "없는 문단")).toBe(false);
  });
});
