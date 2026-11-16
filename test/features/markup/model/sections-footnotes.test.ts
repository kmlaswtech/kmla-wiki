import type { Element, Root } from "hast";
import { toHtml } from "hast-util-to-html";
import { describe, expect, it } from "vitest";

import {
  headingNumberMap,
  numberHeadings,
} from "~/features/markup/model/heading-number";
import { parseWiki } from "~/features/markup/model/parse";

function elements(nodes: Root["children"] | Element["children"]): Element[] {
  return (nodes as Root["children"]).filter(
    (node): node is Element => node.type === "element",
  );
}

/** 묶인 문단 구조를 `[제목, [하위...]]` 꼴로 줄여 본다. */
function outline(nodes: Root["children"] | Element["children"]): unknown[] {
  return elements(nodes)
    .filter((node) => node.properties.dataWikiSection !== undefined)
    .map((section) => {
      const [heading, body] = elements(section.children);
      const text = toHtml(heading!.children);
      return [text, outline(body!.children)];
    });
}

describe("heading numbers", () => {
  const h = (depth: number, index: number) => ({
    depth,
    text: `h${index}`,
    id: `h${index}`,
    index,
  });

  it("numbers nested headings and counts skipped levels as one step", () => {
    const numbered = numberHeadings([
      h(2, 0),
      h(3, 1),
      h(5, 2),
      h(3, 3),
      h(2, 4),
    ]);
    expect(numbered.map((x) => x.number)).toEqual([
      "1",
      "1.1",
      "1.1.1",
      "1.2",
      "2",
    ]);
    expect(numbered.map((x) => x.level)).toEqual([1, 2, 3, 2, 1]);
  });

  it("gives no numbers when the table of contents is not drawn", () => {
    expect(headingNumberMap([h(2, 0), h(2, 1)])).toBeNull();
    expect(headingNumberMap([h(2, 0), h(3, 1), h(2, 2)])?.get(2)).toBe("2");
  });
});

describe("rehypeSections", () => {
  it("wraps each heading with the content up to the next heading of the same or higher level", () => {
    const { tree } = parseWiki(
      "앞글\n\n## 가\n\n가 본문\n\n### 가-1\n\n내용\n\n## 나\n\n나 본문",
    );
    expect(outline(tree.children)).toEqual([
      ["가", [["가-1", []]]],
      ["나", []],
    ]);
    // 첫 제목 앞의 글은 묶이지 않는다.
    expect(elements(tree.children)[0]!.tagName).toBe("p");
  });

  it("keeps the section body content", () => {
    const html = toHtml(parseWiki("## 가\n\n본문 글").tree);
    expect(html).toMatch(
      /<section data-wiki-section="0"><h2[^>]*>가<\/h2><div data-section-body>\s*<p>본문 글<\/p>\s*<\/div><\/section>/,
    );
  });

  it("does not wrap headings inside quotes or the footnote list", () => {
    const { tree } = parseWiki(
      "## 가\n\n> ### 인용 속 제목\n\n각주[^1]\n\n[^1]: 내용",
    );
    expect(outline(tree.children)).toEqual([["가", []]]);
    const last = elements(tree.children).at(-1)!;
    expect(last.properties.dataFootnotes).toBeDefined();
  });
});

describe("collectFootnotes", () => {
  it("collects footnote content without the back link", () => {
    const { footnotes } = parseWiki(
      "본문[^a] 그리고[^2]\n\n[^a]: 첫 [[문서]] 각주\n[^2]: 둘째",
    );
    expect([...footnotes.keys()]).toEqual([
      "user-content-fn-a",
      "user-content-fn-2",
    ]);
    const first = toHtml({
      type: "root",
      children: footnotes.get("user-content-fn-a")!,
    });
    expect(first).toContain("첫");
    expect(first).toContain("문서");
    expect(first).not.toContain("data-footnote-backref");
  });

  it("is empty when there are no footnotes", () => {
    expect(parseWiki("각주 없음").footnotes.size).toBe(0);
  });
});
