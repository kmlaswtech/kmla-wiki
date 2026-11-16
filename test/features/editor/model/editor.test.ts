import { describe, expect, it } from "vitest";

import {
  addFootnote,
  buildTable,
  insertBlock,
  nextFootnoteNumber,
  toggleLinePrefix,
  wrapSelection,
  type TextEdit,
} from "~/features/editor/model/commands";
import {
  completionInsertText,
  findCompletionRequest,
} from "~/features/editor/model/completion";
import {
  isLargeDeletion,
  rebaseSectionEdit,
} from "~/features/editor/model/conflict";

function apply(doc: string, edit: TextEdit) {
  const next =
    doc.slice(0, edit.change.from) +
    edit.change.insert +
    doc.slice(edit.change.to);
  return {
    doc: next,
    selected: next.slice(edit.selection.from, edit.selection.to),
  };
}

describe("toolbar commands", () => {
  it("wraps the selected text", () => {
    const result = apply(
      "신성 시간",
      wrapSelection("신성 시간", { from: 0, to: 2 }, "**", "**", "굵은 글자"),
    );
    expect(result).toEqual({ doc: "**신성** 시간", selected: "신성" });
  });

  it("inserts a placeholder and selects it when nothing is selected", () => {
    const result = apply(
      "",
      wrapSelection("", { from: 0, to: 0 }, "[[", "]]", "문서 이름"),
    );
    expect(result).toEqual({ doc: "[[문서 이름]]", selected: "문서 이름" });
  });

  it("unwraps text that is already wrapped", () => {
    const doc = "**신성** 시간";
    const result = apply(
      doc,
      wrapSelection(doc, { from: 2, to: 4 }, "**", "**", "굵은 글자"),
    );
    expect(result).toEqual({ doc: "신성 시간", selected: "신성" });
  });

  it("turns a line into a heading, switches its level, and turns it back", () => {
    const made = apply(
      "앞\n신청 방법\n뒤",
      toggleLinePrefix("앞\n신청 방법\n뒤", { from: 3, to: 3 }, "## ", "제목"),
    );
    expect(made.doc).toBe("앞\n## 신청 방법\n뒤");

    const switched = apply(
      made.doc,
      toggleLinePrefix(made.doc, { from: 5, to: 5 }, "### ", "제목"),
    );
    expect(switched.doc).toBe("앞\n### 신청 방법\n뒤");

    const removed = apply(
      switched.doc,
      toggleLinePrefix(switched.doc, { from: 5, to: 5 }, "### ", "제목"),
    );
    expect(removed.doc).toBe("앞\n신청 방법\n뒤");
  });

  it("separates an inserted block from the text around it", () => {
    const result = apply(
      "앞 문단\n뒤 문단",
      insertBlock("앞 문단\n뒤 문단", { from: 4, to: 4 }, ":::접기 제목\n내용\n:::", "제목"),
    );
    expect(result.doc).toBe("앞 문단\n\n:::접기 제목\n내용\n:::\n\n뒤 문단");
    expect(result.selected).toBe("제목");
  });

  it("builds a table with a header row", () => {
    expect(buildTable(1, 2)).toBe(
      "| 제목 1 | 제목 2 |\n| --- | --- |\n|     |     |",
    );
  });

  it("numbers a new footnote after the ones already used", () => {
    expect(nextFootnoteNumber("가[^1] 나[^3]")).toBe(2);

    const next = addFootnote("신성은 1시까지다.", { from: 10, to: 10 }, "각주 내용");
    expect(next.doc).toBe("신성은 1시까지다.[^1]\n\n[^1]: 각주 내용\n");
    expect(next.doc.slice(next.selection.from, next.selection.to)).toBe(
      "각주 내용",
    );
  });
});

describe("completion", () => {
  it("offers pages after [[", () => {
    expect(findCompletionRequest("보러 가기: [[귀가/")).toEqual({
      kind: "page",
      query: "귀가/",
      from: 9,
    });
  });

  it("offers categories after [[분류:", () => {
    expect(findCompletionRequest("[[분류:생")).toMatchObject({
      kind: "category",
      query: "생",
      from: 2,
    });
  });

  it("offers templates after {{ with or without the prefix", () => {
    expect(findCompletionRequest("{{오래")).toMatchObject({
      kind: "template",
      query: "오래",
    });
    expect(findCompletionRequest("{{틀:오래")).toMatchObject({
      kind: "template",
      query: "오래",
    });
  });

  it("stops once the name is finished", () => {
    expect(findCompletionRequest("[[귀가]]")).toBeNull();
    expect(findCompletionRequest("[[귀가|집")).toBeNull();
    expect(findCompletionRequest("[[귀가#신")).toBeNull();
    expect(findCompletionRequest("그냥 글")).toBeNull();
  });

  it("adds the closing brackets only when they are missing", () => {
    const request = findCompletionRequest("[[귀")!;
    expect(completionInsertText(request, "귀가", "")).toBe("귀가]]");
    expect(completionInsertText(request, "귀가", "]] 뒤")).toBe("귀가");
  });
});

describe("edit conflicts", () => {
  const base = "머리말\n\n## 가\n가 본문\n\n## 나\n나 본문\n";

  it("re-applies my section when someone changed a different section", () => {
    const latest = "머리말\n\n## 가\n다른 사람이 고친 가\n\n## 나\n나 본문\n";
    const result = rebaseSectionEdit({
      baseBody: base,
      latestBody: latest,
      sectionIndex: 1,
      editedSection: "## 나\n내가 고친 나\n",
    });
    expect(result).toEqual({
      ok: true,
      body: "머리말\n\n## 가\n다른 사람이 고친 가\n\n## 나\n내가 고친 나\n",
    });
  });

  it("refuses when someone changed the same section", () => {
    const latest = "머리말\n\n## 가\n가 본문\n\n## 나\n다른 사람이 고친 나\n";
    expect(
      rebaseSectionEdit({
        baseBody: base,
        latestBody: latest,
        sectionIndex: 1,
        editedSection: "## 나\n내가 고친 나\n",
      }),
    ).toEqual({ ok: false });
  });

  it("refuses when the section no longer exists", () => {
    expect(
      rebaseSectionEdit({
        baseBody: base,
        latestBody: "머리말\n\n## 가\n가 본문\n",
        sectionIndex: 1,
        editedSection: "## 나\n내가 고친 나\n",
      }),
    ).toEqual({ ok: false });
  });

  it("flags an edit that removes more than half of a long page", () => {
    const long = "가".repeat(400);
    expect(isLargeDeletion(long, "가".repeat(150))).toBe(true);
    expect(isLargeDeletion(long, "가".repeat(250))).toBe(false);
    // 짧은 문서는 몇 글자만 지워도 절반이 넘으므로 묻지 않는다.
    expect(isLargeDeletion("짧은 문서", "")).toBe(false);
  });
});
