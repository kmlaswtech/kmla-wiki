/**
 * 마크다운 트리를 위키 규칙에 맞게 다듬는 unified 플러그인들.
 *
 * 각 플러그인은 한 가지 일만 한다. 순서는 `parse.ts`가 정한다.
 */
import type { Element, Root as HastRoot } from "hast";
import type { Heading, Paragraph, Parent, Root, Text } from "mdast";
import { toString } from "mdast-util-to-string";
import { SKIP, visit } from "unist-util-visit";
import type { VFile } from "vfile";

import { createHeadingIdAllocator } from "./heading-id";
import { WIKI_SCHEME } from "./syntax";

// `remark-directive`가 만드는 노드. 그 패키지의 타입에 기대지 않으려고 필요한 만큼만 적는다.
interface DirectiveNode extends Parent {
  type: "containerDirective" | "leafDirective" | "textDirective";
  name: string;
}

function isDirective(node: { type: string }): node is DirectiveNode {
  return (
    node.type === "containerDirective" ||
    node.type === "leafDirective" ||
    node.type === "textDirective"
  );
}

/**
 * `:::fold[제목]`만 접기로 그리고, 나머지 지시문은 원래 글자로 되돌린다.
 *
 * 지시문 문법은 `:이름`만으로도 걸린다. 한국어 글에는 `시간:am`처럼 콜론 뒤에 영문이 오는 일이
 * 흔해서, 되돌리지 않으면 글자가 사라진다.
 */
export function remarkWikiDirectives() {
  return (tree: Root, file: VFile) => {
    const source = String(file.value);

    visit(tree, (node, index, parent) => {
      if (!isDirective(node)) return;

      if (node.type === "containerDirective" && node.name === "fold") {
        node.data = { ...node.data, hName: "details" };
        const label = node.children[0] as Paragraph | undefined;
        if (label?.data && "directiveLabel" in label.data) {
          label.data = { ...label.data, hName: "summary" };
        } else {
          node.children.unshift({
            type: "paragraph",
            data: { hName: "summary" },
            children: [{ type: "text", value: "펼치기" }],
          });
        }
        return;
      }

      if (!parent || index === undefined || !node.position) return;
      const raw = source.slice(
        node.position.start.offset,
        node.position.end.offset,
      );
      const text: Text = { type: "text", value: raw };
      const replacement =
        node.type === "textDirective"
          ? text
          : ({ type: "paragraph", children: [text] } as Paragraph);
      (parent.children as unknown[]).splice(index, 1, replacement);
      return [SKIP, index + 1];
    });
  };
}

/** `__글자__`는 밑줄이다(나무위키와 같은 표기). 표준 마크다운에서는 `**`와 같은 굵게라 원문을 보고 가른다. */
export function remarkUnderline() {
  return (tree: Root, file: VFile) => {
    const source = String(file.value);
    visit(tree, "strong", (node) => {
      const start = node.position?.start.offset;
      if (start !== undefined && source[start] === "_") {
        node.data = { ...node.data, hName: "u" };
      }
    });
  };
}

const PHRASING_PARENTS = new Set([
  "paragraph",
  "heading",
  "emphasis",
  "strong",
  "delete",
  "link",
  "tableCell",
]);

/** 원시 HTML은 지원하지 않는다. 지우지 않고 글자로 보여 준다(쓴 사람이 왜 안 되는지 알 수 있게). */
export function remarkHtmlAsText() {
  return (tree: Root) => {
    visit(tree, "html", (node, index, parent) => {
      if (!parent || index === undefined) return;
      const text: Text = { type: "text", value: node.value };
      const replacement = PHRASING_PARENTS.has(parent.type)
        ? text
        : ({ type: "paragraph", children: [text] } as Paragraph);
      (parent.children as unknown[]).splice(index, 1, replacement);
      return [SKIP, index + 1];
    });
  };
}

export interface HeadingInfo {
  /** 2~6. `#` 한 개는 문서 제목용이라 2단계로 그린다. */
  depth: number;
  text: string;
  id: string;
  /** 문서 안에서 몇 번째 제목인지(0부터). 문단 편집이 이 번호로 원문의 문단을 찾는다. */
  index: number;
}

/** 제목에 id를 붙이고 목차용 정보를 트리에 남긴다. */
export function remarkHeadings() {
  return (tree: Root) => {
    const allocate = createHeadingIdAllocator();
    let index = 0;

    visit(tree, "heading", (node: Heading) => {
      if (node.depth === 1) node.depth = 2;
      const info: HeadingInfo = {
        depth: node.depth,
        text: toString(node),
        id: allocate(toString(node)),
        index: index++,
      };
      node.data = {
        ...node.data,
        hProperties: { id: info.id, dataHeadingIndex: info.index },
        // `collectHeadings`가 읽는다.
        ...({ wikiHeading: info } as object),
      };
    });
  };
}

export function collectHeadings(tree: Root): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  visit(tree, "heading", (node: Heading) => {
    const info = (node.data as { wikiHeading?: HeadingInfo } | undefined)
      ?.wikiHeading;
    if (info) headings.push(info);
  });
  return headings;
}

const SAFE_LINK = /^(https?:|mailto:|#)/i;
const UPLOADED_IMAGE_SRC =
  /^img:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 링크와 이미지 주소를 걸러 낸다.
 *
 *  - 링크는 `http(s)`, `mailto`, 문서 안 이동(`#`), 내부 링크(`wiki:`)만 남긴다. `javascript:` 같은
 *    주소는 링크가 아닌 글자로 남는다.
 *  - 이미지는 위키에 올린 것(`img:`)만 그린다. 바깥 주소의 이미지는 읽는 사람의 접속 정보를
 *    제3자에게 넘기므로 링크로 바꾼다.
 */
export function rehypeSafeUrls() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName === "a") {
        const href = node.properties.href;
        if (
          typeof href !== "string" ||
          !(SAFE_LINK.test(href) || href.startsWith(WIKI_SCHEME))
        ) {
          delete node.properties.href;
        }
        return;
      }

      if (node.tagName === "img") {
        const src = node.properties.src;
        if (typeof src === "string" && UPLOADED_IMAGE_SRC.test(src)) return;

        const alt =
          typeof node.properties.alt === "string" ? node.properties.alt : "";
        const external = typeof src === "string" && /^https?:/i.test(src);
        node.tagName = external ? "a" : "span";
        node.properties = external ? { href: src } : {};
        node.children = [{ type: "text", value: alt || (external ? src : "") }];
      }
    });
  };
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function isElement(node: HastRoot["children"][number]): node is Element {
  return node.type === "element";
}

function isWikiHeading(node: Element): boolean {
  return (
    HEADING_TAGS.has(node.tagName) &&
    node.properties.dataHeadingIndex !== undefined
  );
}

function isFootnoteSection(node: Element): boolean {
  return (
    node.tagName === "section" && node.properties.dataFootnotes !== undefined
  );
}

/**
 * 맨 바깥의 제목마다 그 문단을 하나로 묶는다. 문단 접기가 이 묶음을 쓴다.
 *
 * ```html
 * <section data-wiki-section="0">
 *   <h2>…</h2>
 *   <div data-section-body>…다음 같은 단계 제목 전까지(하위 문단 포함)…</div>
 * </section>
 * ```
 *
 * 인용·접기 안의 제목은 본문 흐름의 문단이 아니라서 묶지 않는다. 각주 목록도 묶지 않는다.
 */
export function rehypeSections() {
  return (tree: HastRoot) => {
    const root: HastRoot["children"] = [];
    const open: { depth: number; body: Element }[] = [];

    for (const node of tree.children) {
      if (isElement(node) && isFootnoteSection(node)) {
        open.length = 0;
        root.push(node);
        continue;
      }

      if (isElement(node) && isWikiHeading(node)) {
        const depth = Number(node.tagName.slice(1));
        while (open.length > 0 && open[open.length - 1]!.depth >= depth) {
          open.pop();
        }
        const body: Element = {
          type: "element",
          tagName: "div",
          properties: { dataSectionBody: true },
          children: [],
        };
        const section: Element = {
          type: "element",
          tagName: "section",
          properties: { dataWikiSection: node.properties.dataHeadingIndex },
          children: [node, body],
        };
        (open.at(-1)?.body.children ?? root).push(section);
        open.push({ depth, body });
        continue;
      }

      const parent = open.at(-1)?.body.children ?? root;
      parent.push(node);
    }

    tree.children = root;
  };
}

/** 각주 번호를 누르거나 올렸을 때 보여 줄 각주 내용. 키는 각주의 id(`user-content-fn-1`). */
export type FootnoteMap = ReadonlyMap<string, Element["children"]>;

function withoutBackrefs(children: Element["children"]): Element["children"] {
  return children
    .filter(
      (child) =>
        !(
          child.type === "element" &&
          child.properties.dataFootnoteBackref !== undefined
        ),
    )
    .map((child) =>
      child.type === "element"
        ? { ...child, children: withoutBackrefs(child.children) }
        : child,
    );
}

/** 화면용 트리의 각주 목록에서 각주마다 내용을 뽑는다. "본문으로 돌아가기" 링크는 뺀다. */
export function collectFootnotes(tree: HastRoot): FootnoteMap {
  const footnotes = new Map<string, Element["children"]>();
  for (const node of tree.children) {
    if (!isElement(node) || !isFootnoteSection(node)) continue;
    visit(node, "element", (item: Element) => {
      if (item.tagName !== "li" || typeof item.properties.id !== "string") {
        return;
      }
      footnotes.set(item.properties.id, withoutBackrefs(item.children));
      return SKIP;
    });
  }
  return footnotes;
}
