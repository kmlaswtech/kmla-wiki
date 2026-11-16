import { toHtml } from "hast-util-to-html";
import { describe, expect, it } from "vitest";

import { parseWiki } from "~/features/markup/model/parse";
import { preprocess } from "~/features/markup/model/preprocess";
import { extractRefs } from "~/features/markup/model/refs";
import {
  findSections,
  getSection,
  replaceSection,
} from "~/features/markup/model/sections";
import {
  ancestorTitles,
  isValidTitle,
  normalizeTitle,
  parseTitle,
  titleToPath,
} from "~/features/markup/model/title";
import { REF_CASES } from "./ref-cases";

function render(body: string, templates: Record<string, string> = {}) {
  const parsed = parseWiki(body, {
    templates: new Map(Object.entries(templates)),
  });
  return { ...parsed, html: toHtml(parsed.tree) };
}

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

describe("preprocess", () => {
  it("turns wiki links into markdown links with the wiki scheme", () => {
    expect(preprocess("[[귀가|집에 가기]]").markdown).toBe(
      `[집에 가기](wiki:${encodeURIComponent("귀가")})`,
    );
  });

  it("collects categories and removes them from the text", () => {
    const result = preprocess("본문\n\n[[분류:생활]] [[분류:규정]]");
    expect(result.categories).toEqual(["분류:생활", "분류:규정"]);
    expect(result.markdown).not.toContain("분류");
  });

  it("reports a redirect", () => {
    expect(preprocess("#넘겨주기 [[PRISM]]").redirect).toBe("PRISM");
    expect(preprocess("글").redirect).toBeNull();
  });

  it("leaves wiki syntax inside code alone", () => {
    const body = "`[[코드]]`\n\n```\n{{틀:코드}}\n```";
    expect(preprocess(body).markdown).toBe(body);
  });
});

describe("parseWiki", () => {
  it("renders an internal link without leaking the pipe into a table", () => {
    const { html } = render(
      "| 이름 | 뜻 |\n| --- | --- |\n| [[덕고관/엘리베이터|중베]] | 가운데 |",
    );
    expect(html).toContain("<table>");
    expect(html).toContain(
      `href="wiki:${encodeURIComponent("덕고관/엘리베이터")}"`,
    );
    expect(html).toContain(">중베</a>");
    expect(html).toContain("<td>가운데</td>");
  });

  it("renders underline, strikethrough and bold next to Korean particles", () => {
    const { html } = render("__밑줄__ ~~취소~~ **끝.**다음");
    expect(html).toContain("<u>밑줄</u>");
    expect(html).toContain("<del>취소</del>");
    expect(html).toContain("<strong>끝.</strong>다음");
  });

  it("renders a fold as details with the title as summary", () => {
    const { html } = render(":::접기 자세한 내용\n\n숨긴 **글**\n\n:::");
    expect(html).toContain("<details>");
    expect(html).toContain("<summary>자세한 내용</summary>");
    expect(html).toContain("<strong>글</strong>");
  });

  it("keeps text that only looks like a directive", () => {
    const { html } = render("수업 시간:am 9시, 이모지 :smile: 그대로");
    expect(html).toContain("시간:am 9시");
    expect(html).toContain(":smile:");
  });

  it("shows raw HTML as text instead of running it", () => {
    const { html } = render(
      '<script>alert(1)</script>\n\n글 <b onclick="x()">굵게</b>',
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b ");
    expect(html).toContain("&#x3C;script>");
  });

  it("drops unsafe link targets and keeps safe ones", () => {
    const { html } = render(
      "[나쁨](javascript:alert(1)) [좋음](https://kmla.online) [메일](mailto:a@b.c)",
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://kmla.online"');
    expect(html).toContain('href="mailto:a@b.c"');
  });

  it("turns an external image into a link and keeps an uploaded one", () => {
    const id = "0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a";
    const { html } = render(
      `![밖](https://example.com/a.png) ![안](img:${id})`,
    );
    expect(html).not.toContain('src="https://example.com/a.png"');
    expect(html).toContain('<a href="https://example.com/a.png">밖</a>');
    expect(html).toContain(`src="img:${id}"`);
  });

  it("gives headings ids, shifts # to the second level and numbers them", () => {
    const { headings, html } = render("# 개요\n\n## 신청 방법\n\n## 신청 방법");
    expect(headings).toEqual([
      { depth: 2, text: "개요", id: "개요", index: 0 },
      { depth: 2, text: "신청 방법", id: "신청-방법", index: 1 },
      { depth: 2, text: "신청 방법", id: "신청-방법-2", index: 2 },
    ]);
    expect(html).toContain('<h2 id="개요" data-heading-index="0">개요</h2>');
    expect(html).not.toContain("<h1");
  });

  it("links a section with the same id the heading gets", () => {
    const { html } = render("[[귀가#신청 방법]] [[#신청 방법]]");
    expect(html).toContain(
      `href="wiki:${encodeURIComponent("귀가")}#${encodeURI("신청-방법")}"`,
    );
    // 주소는 퍼센트 인코딩되어 나간다. 브라우저가 id와 맞출 때 다시 푼다.
    expect(html).toContain(`href="#${encodeURI("신청-방법")}"`);
  });

  it("renders footnotes with Korean labels", () => {
    const { html } = render(
      "신성은 1시까지다.[^1]\n\n[^1]: 2025년까지는 12시 30분.",
    );
    expect(html).toContain("각주");
    expect(html).toContain("2025년까지는 12시 30분.");
  });

  describe("templates", () => {
    it("includes a template body and fills its values", () => {
      const { html } = render("{{틀:상위 문서|외출·외박}}", {
        "틀:상위 문서": "> 상위 문서: [[{{{1}}}]]",
      });
      expect(html).toContain("<blockquote>");
      expect(html).toContain(`href="wiki:${encodeURIComponent("외출·외박")}"`);
    });

    it("leaves a link to a missing template", () => {
      const { html } = render("{{틀:없는 틀}}");
      expect(html).toContain(`href="wiki:${encodeURIComponent("틀:없는 틀")}"`);
    });

    it("does not loop on a template that includes itself", () => {
      const { html } = render("{{틀:돌고}}", {
        "틀:돌고": "앞 {{틀:돌고}} 뒤",
      });
      expect(html).toContain("앞 ");
      expect(html).toContain(`href="wiki:${encodeURIComponent("틀:돌고")}"`);
    });

    it("stops at three levels of nesting", () => {
      const { html } = render("{{틀:1}}", {
        "틀:1": "하나 {{틀:2}}",
        "틀:2": "둘 {{틀:3}}",
        "틀:3": "셋 {{틀:4}}",
        "틀:4": "넷",
      });
      expect(html).toContain("하나 둘 셋");
      expect(html).not.toContain("넷");
    });

    it("does not inherit the template's own categories", () => {
      const { categories } = render("{{틀:정리 필요}}\n\n[[분류:생활]]", {
        "틀:정리 필요": "> 정리가 필요합니다.\n\n[[분류:틀]]",
      });
      expect(categories).toEqual(["분류:생활"]);
    });
  });
});

describe("sections", () => {
  const source = [
    "머리말",
    "",
    "## 가",
    "가 본문",
    "",
    "### 가-1",
    "가-1 본문",
    "",
    "```",
    "## 코드 안 제목 아님",
    "```",
    "",
    "## 나",
    "나 본문",
  ].join("\n");

  it("finds headings outside code and nests lower levels", () => {
    const sections = findSections(source);
    expect(sections.map((s) => [s.index, s.depth, s.title])).toEqual([
      [0, 2, "가"],
      [1, 3, "가-1"],
      [2, 2, "나"],
    ]);
    expect(getSection(source, 0)).toContain("가-1 본문");
    expect(getSection(source, 0)).not.toContain("나 본문");
    expect(getSection(source, 1)).toContain("코드 안 제목 아님");
    expect(getSection(source, 9)).toBeNull();
  });

  it("numbers sections the same way the renderer numbers headings", () => {
    expect(findSections(source).map((s) => s.title)).toEqual(
      parseWiki(source).headings.map((h) => h.text),
    );
  });

  it("replaces one section and leaves the rest untouched", () => {
    const replaced = replaceSection(source, 1, "### 가-1\n고친 본문\n");
    expect(replaced).toContain(
      "가 본문\n\n### 가-1\n고친 본문\n\n## 나\n나 본문",
    );
    expect(replaced?.startsWith("머리말\n\n## 가")).toBe(true);
  });

  it("replaces the last section without leaving a gap at the end", () => {
    expect(replaceSection(source, 2, "## 나\n새 본문")).toMatch(
      /## 나\n새 본문\n$/,
    );
  });
});
