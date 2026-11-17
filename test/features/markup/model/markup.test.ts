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
} from "./doc-builders";
import { REF_CASES } from "./ref-cases";
import { MISSING_TEMPLATE, parseWiki } from "~/features/markup/model/parse";
import { extractRefs } from "~/features/markup/model/refs";
import {
  findSections,
  getSection,
  isBlank,
  replaceSection,
} from "~/features/markup/model/sections";
import { docToText, visibleTextLength } from "~/features/markup/model/text";
import {
  ancestorTitles,
  isValidTitle,
  normalizeTitle,
  parseTitle,
  titleToPath,
} from "~/features/markup/model/title";

describe("title", () => {
  it("normalizes spacing, underscores and namespace separators", () => {
    expect(normalizeTitle(" 귀가 /  정기_귀가 ")).toBe("귀가/정기 귀가");
    expect(normalizeTitle("틀 : 오래된 정보")).toBe("틀:오래된 정보");
    expect(normalizeTitle("   ")).toBeNull();
  });

  it("rejects characters that mean something in wiki syntax or URLs", () => {
    for (const bad of [
      "a[b",
      "a|b",
      "a#b",
      "a{b}",
      "/a",
      "a/",
      "a//b",
      "..",
      "a/../b",
      "틀:",
      ":a",
    ]) {
      expect(isValidTitle(bad), bad).toBe(false);
    }
    expect(isValidTitle("외출·외박")).toBe(true);
    expect(isValidTitle("가".repeat(100))).toBe(true);
    expect(isValidTitle("가".repeat(101))).toBe(false);
  });

  it("turns a title into a path and lists its ancestors", () => {
    expect(titleToPath("귀가/정기 귀가")).toBe(
      `${encodeURIComponent("귀가")}/${encodeURIComponent("정기_귀가")}`,
    );
    expect(ancestorTitles("귀가/정기 귀가/신청")).toEqual([
      "귀가",
      "귀가/정기 귀가",
    ]);
    expect(parseTitle("나쁜<제목>")).toBeNull();
  });
});

describe("extractRefs (same cases as the database)", () => {
  for (const { name, body, expected } of REF_CASES) {
    it(name, () => {
      const actual = extractRefs(body)
        .map((ref) => `${ref.kind}=${ref.target}`)
        .sort()
        .join(" ");
      expect(actual).toBe(expected.split(" ").sort().join(" ").trim());
    });
  }
});

describe("parseWiki", () => {
  it("gives top-level headings ids, numbers and section indexes", () => {
    const { headings } = parseWiki(
      doc(heading(2, "개요"), heading(3, "신청 방법"), heading(2, "신청 방법")),
    );
    expect(headings).toEqual([
      { depth: 2, text: "개요", id: "개요", index: 0, sectionIndex: 0 },
      {
        depth: 3,
        text: "신청 방법",
        id: "신청-방법",
        index: 1,
        sectionIndex: 1,
      },
      {
        depth: 2,
        text: "신청 방법",
        id: "신청-방법-2",
        index: 2,
        sectionIndex: 2,
      },
    ]);
  });

  it("numbers footnotes in order, including those inside folds", () => {
    const { footnotes, blocks } = parseWiki(
      doc(para(text("가"), footnote("첫째")), {
        type: "fold",
        attrs: { title: "더" },
        content: [para(footnote("둘째"))],
      }),
    );
    expect(footnotes).toEqual([
      { number: 1, note: "첫째" },
      { number: 2, note: "둘째" },
    ]);
    expect(blocks[0]!.node.content![1]!.attrs).toMatchObject({ number: 1 });
  });

  it("reads categories and a redirect from the document attributes", () => {
    const parsed = parseWiki({
      ...doc(para()),
      attrs: {
        categories: ["생활", "분류:생활", "분류:기숙사"],
        redirect: "PRISM",
      },
    });
    expect(parsed.categories).toEqual(["분류:생활", "분류:기숙사"]);
    expect(parsed.redirect).toBe("PRISM");
  });

  it("treats anything that is not a document as an empty one", () => {
    for (const value of [null, "글", 1, { type: "paragraph" }]) {
      expect(parseWiki(value).blocks).toEqual([
        { node: { type: "paragraph" } },
      ]);
    }
  });

  describe("templates", () => {
    const notice = doc(para(text("주의: "), param(1), text(" 끝")));

    it("includes a template body and fills its values", () => {
      const { blocks } = parseWiki(doc(template("오래된 정보", ["값"])), {
        templates: new Map([["틀:오래된 정보", notice]]),
      });
      expect(blocks.map((block) => block.node)).toEqual([
        para(text("주의: "), text("값"), text(" 끝")),
      ]);
    });

    it("passes its own values on to a template it calls", () => {
      const { blocks } = parseWiki(doc(template("감싸기", ["값"])), {
        templates: new Map([
          ["틀:감싸기", doc(template("오래된 정보", ["{{{1}}}"]))],
          ["틀:오래된 정보", notice],
        ]),
      });
      expect(blocks.map((block) => block.node)).toEqual([
        para(text("주의: "), text("값"), text(" 끝")),
      ]);
    });

    it("keeps the formatting the template put on a value's slot", () => {
      const bold = { type: "bold" };
      const body = doc(para({ ...param(1), marks: [bold] }));
      const { blocks } = parseWiki(doc(template("강조", ["값"])), {
        templates: new Map([["틀:강조", body]]),
      });
      expect(blocks.map((block) => block.node)).toEqual([
        para({ type: "text", text: "값", marks: [bold] }),
      ]);
    });

    it("drops an empty value", () => {
      const { blocks } = parseWiki(doc(template("틀:오래된 정보")), {
        templates: new Map([["틀:오래된 정보", notice]]),
      });
      expect(blocks[0]!.node).toEqual(para(text("주의: "), text(" 끝")));
    });

    it("leaves a marker for a missing template", () => {
      const { blocks } = parseWiki(doc(template("없는 틀")));
      expect(blocks[0]!.node).toEqual({
        type: MISSING_TEMPLATE,
        attrs: { title: "틀:없는 틀" },
      });
    });

    it("does not loop on a template that includes itself", () => {
      const { blocks } = parseWiki(doc(template("자기")), {
        templates: new Map([
          ["틀:자기", doc(para(text("안")), template("자기"))],
        ]),
      });
      expect(blocks.map((block) => block.node.type)).toEqual([
        "paragraph",
        MISSING_TEMPLATE,
      ]);
    });

    it("stops at three levels of nesting", () => {
      const templates = new Map([
        ["틀:1", doc(para(text("1")), template("2"))],
        ["틀:2", doc(para(text("2")), template("3"))],
        ["틀:3", doc(para(text("3")), template("4"))],
        ["틀:4", doc(para(text("4")))],
      ]);
      const { blocks } = parseWiki(doc(template("1")), { templates });
      expect(blocks.map((block) => block.node.type)).toEqual([
        "paragraph",
        "paragraph",
        "paragraph",
        MISSING_TEMPLATE,
      ]);
    });

    it("lists template headings in the contents but not as editable sections", () => {
      const { headings } = parseWiki(
        doc(template("머리"), heading(2, "내 문단")),
        { templates: new Map([["틀:머리", doc(heading(2, "틀 문단"))]]) },
      );
      expect(headings.map((h) => [h.text, h.sectionIndex])).toEqual([
        ["틀 문단", null],
        ["내 문단", 0],
      ]);
    });

    it("does not inherit the template's own categories", () => {
      const { categories } = parseWiki(doc(template("분류 붙은 틀")), {
        templates: new Map([
          [
            "틀:분류 붙은 틀",
            { ...doc(para(text("틀"))), attrs: { categories: ["분류:틀"] } },
          ],
        ]),
      });
      expect(categories).toEqual([]);
    });
  });
});

describe("sections", () => {
  const body = doc(
    para(text("앞글")),
    heading(2, "가"),
    para(text("가 본문")),
    heading(3, "가-1"),
    para(text("내용")),
    heading(2, "나"),
    para(text("나 본문")),
  );

  it("finds top-level headings and nests lower levels", () => {
    expect(
      findSections(body).map(({ title, start, end }) => [title, start, end]),
    ).toEqual([
      ["가", 1, 5],
      ["가-1", 3, 5],
      ["나", 5, 7],
    ]);
  });

  it("ignores headings inside quotes and folds", () => {
    const nested = doc(
      { type: "blockquote", content: [heading(2, "인용")] },
      heading(2, "진짜"),
    );
    expect(findSections(nested).map((section) => section.title)).toEqual([
      "진짜",
    ]);
  });

  it("returns one section with its subsections", () => {
    expect(getSection(body, 0)).toEqual(
      doc(
        heading(2, "가"),
        para(text("가 본문")),
        heading(3, "가-1"),
        para(text("내용")),
      ),
    );
    expect(getSection(body, 9)).toBeNull();
  });

  it("replaces one section, keeps the rest and the document attributes", () => {
    const withMeta = { ...body, attrs: { categories: ["분류:생활"] } };
    const replaced = replaceSection(
      withMeta,
      2,
      doc(heading(2, "나"), para(text("새 글"))),
    );
    expect(replaced).toEqual({
      ...withMeta,
      content: [
        ...body.content.slice(0, 5),
        heading(2, "나"),
        para(text("새 글")),
      ],
    });
  });

  it("removes a section that was emptied", () => {
    const replaced = replaceSection(body, 2, doc(para()));
    expect(replaced!.content).toEqual(body.content.slice(0, 5));
  });

  it("knows a blank document", () => {
    expect(isBlank(doc(para()))).toBe(true);
    expect(isBlank(doc(para(text("글"))))).toBe(false);
    expect(isBlank(doc({ type: "horizontalRule" }))).toBe(false);
  });
});

describe("docToText", () => {
  it("writes formatting and structure the way wiki users know it", () => {
    const written = docToText({
      ...doc(
        heading(2, "개요"),
        para(
          { type: "text", text: "굵게", marks: [{ type: "bold" }] },
          text(" "),
          link("신성", "신성 시간"),
          footnote("출처"),
        ),
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [para(text("하나"))] }],
        },
        template("오래된 정보", ["값"]),
      ),
      attrs: { categories: ["분류:생활"], redirect: "" },
    });
    expect(written).toBe(
      [
        "## 개요",
        "",
        "**굵게** [[신성|신성 시간]][* 출처]",
        "",
        "- 하나",
        "",
        "{{틀:오래된 정보|값}}",
        "",
        "[[분류:생활]]",
      ].join("\n"),
    );
  });

  it("tells apart images with the same description", () => {
    const image = (id: string) => ({
      type: "image",
      attrs: { id, alt: "급식실" },
    });
    expect(
      docToText(doc(image("aaaaaaaa-0000-4000-8000-000000000000"))),
    ).not.toBe(docToText(doc(image("bbbbbbbb-0000-4000-8000-000000000000"))));
  });

  it("does not break on a heading level out of range", () => {
    expect(docToText(doc({ ...heading(2, "가"), attrs: { level: -3 } }))).toBe(
      "## 가",
    );
    expect(docToText(doc({ ...heading(2, "가"), attrs: { level: 1e9 } }))).toBe(
      "#### 가",
    );
  });

  it("starts a redirect page with the redirect line", () => {
    expect(docToText({ ...doc(para()), attrs: { redirect: "PRISM" } })).toBe(
      "#넘겨주기 [[PRISM]]",
    );
  });

  it("counts only visible text", () => {
    expect(
      visibleTextLength(
        doc(
          para({ type: "text", text: "굵게", marks: [{ type: "bold" }] }),
          para(footnote("각주")),
        ),
      ),
    ).toBe(4);
  });
});
