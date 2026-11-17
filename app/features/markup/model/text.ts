import {
  MARK,
  NODE,
  numberAttr,
  stringAttr,
  stringListAttr,
  walk,
  type WikiDoc,
  type WikiMark,
  type WikiNode,
} from "./doc";
import { templateTitle } from "./refs";
import { headingDepth } from "./sections";

/**
 * 문서를 사람이 읽는 글자로 편다. 판 비교와 편집 충돌 화면이 이 글자끼리 비교한다.
 *
 * 같은 문서는 언제나 같은 글자가 되어야 한다(비교가 흔들리지 않게). 꾸밈은 위키 사용자에게 익숙한
 * 표기(`**굵게**`, `[[링크]]`)로 적어, 글자만 바뀌었는지 꾸밈이 바뀌었는지 비교에서 보이게 한다.
 * 되돌려 읽는 일은 없다(저장은 언제나 구조로 한다).
 */
export function docToText(doc: WikiDoc): string {
  const lines: string[] = [];
  const redirect = doc.attrs?.redirect;
  if (typeof redirect === "string" && redirect !== "") {
    lines.push(`#넘겨주기 [[${redirect}]]`, "");
  }
  lines.push(blocksToText(doc.content));
  const categories = doc.attrs?.categories ?? [];
  if (categories.length > 0) {
    lines.push("", ...categories.map((category) => `[[${category}]]`));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 화면에 보이는 글자의 양. 큰 삭제를 알아챌 때 쓴다(꾸밈 표기는 세지 않는다). */
export function visibleTextLength(doc: WikiDoc): number {
  let length = 0;
  walk(doc.content, (node) => {
    if (node.type === NODE.text) length += (node.text ?? "").trim().length;
    if (node.type === NODE.footnote) length += stringAttr(node, "note").length;
  });
  return length;
}

function blocksToText(blocks: readonly WikiNode[]): string {
  return blocks.map(blockToText).join("\n\n");
}

function indent(text: string, first: string, rest: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? first : rest) + line)
    .join("\n");
}

function blockToText(node: WikiNode): string {
  switch (node.type) {
    case NODE.paragraph:
      return inlineToText(node.content ?? []);
    case NODE.heading: {
      const marker = "#".repeat(headingDepth(node));
      return `${marker} ${inlineToText(node.content ?? [])}`;
    }
    case NODE.bulletList:
      return (node.content ?? [])
        .map((item) => indent(blocksToText(item.content ?? []), "- ", "  "))
        .join("\n");
    case NODE.orderedList: {
      const start = numberAttr(node, "start") ?? 1;
      return (node.content ?? [])
        .map((item, index) => {
          const marker = `${start + index}. `;
          return indent(
            blocksToText(item.content ?? []),
            marker,
            " ".repeat(marker.length),
          );
        })
        .join("\n");
    }
    case NODE.blockquote:
      return indent(blocksToText(node.content ?? []), "> ", "> ");
    case NODE.codeBlock:
      return `\`\`\`\n${inlineToText(node.content ?? [])}\n\`\`\``;
    case NODE.horizontalRule:
      return "----";
    case NODE.table:
      return (node.content ?? [])
        .map(
          (row) =>
            `| ${(row.content ?? [])
              .map((cell) => cellToText(cell))
              .join(" | ")} |`,
        )
        .join("\n");
    case NODE.fold:
      return `:::접기 ${stringAttr(node, "title")}\n${blocksToText(node.content ?? [])}\n:::`;
    case NODE.template: {
      const args = stringListAttr(node, "args");
      const name = stringAttr(node, "name");
      return `{{${templateTitle(name) ?? name}${args.map((arg) => `|${arg}`).join("")}}}`;
    }
    case NODE.image: {
      // 설명이 같은 다른 이미지로 바꾼 것도 비교에 보이게 이미지 번호 앞부분을 적는다.
      const id = stringAttr(node, "id").slice(0, 8);
      const alt = stringAttr(node, "alt");
      return `[이미지 ${id}${alt ? `: ${alt}` : ""}]`;
    }
    default:
      return node.content ? blocksToText(node.content) : "";
  }
}

/** 표 칸 하나. 제목 칸과 합친 칸도 비교에 보이게 표시한다. */
function cellToText(cell: WikiNode): string {
  const marks: string[] = [];
  if (cell.type === NODE.tableHeader) marks.push("제목 칸");
  const colspan = numberAttr(cell, "colspan") ?? 1;
  const rowspan = numberAttr(cell, "rowspan") ?? 1;
  if (colspan > 1) marks.push(`가로 ${colspan}칸`);
  if (rowspan > 1) marks.push(`세로 ${rowspan}칸`);
  const text = blocksToText(cell.content ?? []).replace(/\n+/g, " / ");
  return marks.length > 0 ? `(${marks.join(", ")}) ${text}` : text;
}

/** 겉에서 안으로 감싸는 순서. 링크가 가장 바깥이다. */
const MARK_ORDER: readonly string[] = [
  MARK.wikiLink,
  MARK.link,
  MARK.bold,
  MARK.italic,
  MARK.underline,
  MARK.strike,
  MARK.code,
];

function wrapMark(text: string, mark: WikiMark): string {
  switch (mark.type) {
    case MARK.bold:
      return `**${text}**`;
    case MARK.italic:
      return `*${text}*`;
    case MARK.underline:
      return `__${text}__`;
    case MARK.strike:
      return `~~${text}~~`;
    case MARK.code:
      return `\`${text}\``;
    case MARK.link:
      return `[${text}](${stringAttr(mark, "href")})`;
    case MARK.wikiLink: {
      const target = stringAttr(mark, "target");
      const section = stringAttr(mark, "section");
      const address = section ? `${target}#${section}` : target;
      return text === address ? `[[${address}]]` : `[[${address}|${text}]]`;
    }
    default:
      return text;
  }
}

function inlineToText(nodes: readonly WikiNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case NODE.text: {
          const marks = [...(node.marks ?? [])].sort(
            (a, b) => MARK_ORDER.indexOf(b.type) - MARK_ORDER.indexOf(a.type),
          );
          return marks.reduce(wrapMark, node.text ?? "");
        }
        case NODE.hardBreak:
          return "\n";
        case NODE.footnote:
          return `[* ${stringAttr(node, "note")}]`;
        case NODE.templateParam:
          return `{{{${numberAttr(node, "index") ?? 1}}}}`;
        default:
          return node.content ? inlineToText(node.content) : "";
      }
    })
    .join("");
}
