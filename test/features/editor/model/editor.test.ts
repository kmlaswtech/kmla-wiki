import { describe, expect, it } from "vitest";

import {
  doc,
  footnote,
  heading,
  link,
  para,
  param,
  template,
  text,
} from "../../markup/model/doc-builders";
import {
  isLargeDeletion,
  rebaseSectionEdit,
} from "~/features/editor/model/conflict";
import {
  joinDoc,
  normalizeDoc,
  sameDoc,
  splitDoc,
  stableKey,
} from "~/features/editor/model/doc-io";

describe("document attributes", () => {
  it("splits categories and the redirect off and joins them back", () => {
    const body = {
      ...doc(para(text("글"))),
      attrs: { categories: ["분류:생활"], redirect: "PRISM" },
    };
    const { content, meta } = splitDoc(body);
    expect(content.attrs).toBeUndefined();
    expect(meta).toEqual({ categories: ["분류:생활"], redirect: "PRISM" });
    expect(joinDoc(content, meta)).toEqual(body);
  });

  it("drops empty attributes, duplicate categories and trailing empty paragraphs", () => {
    const joined = joinDoc(doc(para(text("글")), para(), para()), {
      categories: ["생활", "분류:생활", " "],
      redirect: "  ",
    });
    expect(joined).toEqual({
      ...doc(para(text("글"))),
      attrs: { categories: ["분류:생활"] },
    });
  });

  it("keeps one paragraph in an empty document", () => {
    expect(
      joinDoc(doc(para(), para()), { categories: [], redirect: "" }),
    ).toEqual(doc(para()));
  });
});

describe("normalizeDoc", () => {
  it("keeps every wiki node and mark", () => {
    const body = doc(
      heading(2, "개요"),
      para(link("신성", "신성 시간", "규칙"), footnote("출처"), param(1)),
      template("틀:오래된 정보", ["값"]),
      {
        type: "image",
        attrs: { id: "0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a", alt: "지도" },
      },
      { type: "fold", attrs: { title: "더" }, content: [para(text("숨김"))] },
    );
    expect(sameDoc(normalizeDoc(body), body)).toBe(true);
  });

  it("drops nodes the editor does not know", () => {
    const normalized = normalizeDoc(
      doc(para(text("글")), { type: "script", content: [text("x")] }),
    );
    expect(JSON.stringify(normalized)).not.toContain("script");
  });

  it("compares documents regardless of key order", () => {
    expect(stableKey({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      stableKey({ a: [{ c: 3, d: 2 }], b: 1 }),
    );
  });
});

describe("edit conflicts", () => {
  const base = doc(
    heading(2, "가"),
    para(text("가 본문")),
    heading(2, "나"),
    para(text("나 본문")),
  );

  it("re-applies my section when someone changed a different section", () => {
    const latest = doc(
      heading(2, "가"),
      para(text("가 본문 고침")),
      heading(2, "나"),
      para(text("나 본문")),
    );
    const result = rebaseSectionEdit({
      baseBody: base,
      latestBody: latest,
      sectionIndex: 1,
      editedSection: doc(heading(2, "나"), para(text("내 글"))),
    });
    expect(result).toEqual({
      ok: true,
      body: doc(
        heading(2, "가"),
        para(text("가 본문 고침")),
        heading(2, "나"),
        para(text("내 글")),
      ),
    });
  });

  it("refuses when someone changed the same section", () => {
    expect(
      rebaseSectionEdit({
        baseBody: base,
        latestBody: doc(
          heading(2, "가"),
          para(text("가 본문")),
          heading(2, "나"),
          para(text("남의 글")),
        ),
        sectionIndex: 1,
        editedSection: doc(heading(2, "나"), para(text("내 글"))),
      }),
    ).toEqual({ ok: false });
  });

  it("refuses when the section no longer exists", () => {
    expect(
      rebaseSectionEdit({
        baseBody: base,
        latestBody: doc(heading(2, "가"), para(text("가 본문"))),
        sectionIndex: 1,
        editedSection: doc(heading(2, "나")),
      }),
    ).toEqual({ ok: false });
  });

  it("flags an edit that removes more than half of a long page", () => {
    const long = doc(para(text("가".repeat(300))));
    expect(isLargeDeletion(long, doc(para(text("가".repeat(100)))))).toBe(true);
    expect(isLargeDeletion(long, doc(para(text("가".repeat(200)))))).toBe(
      false,
    );
    expect(isLargeDeletion(doc(para(text("짧은 글"))), doc(para()))).toBe(
      false,
    );
  });
});
