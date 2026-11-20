/**
 * 문서 본문의 모양. 편집기(Tiptap/ProseMirror)가 내놓는 JSON을 그대로 저장한다.
 *
 * 저장하는 것은 마크다운 같은 글자가 아니라 이 구조다. 그래서 파싱이 없다. 링크·틀·이미지는
 * 노드나 마크로 따로 있어, 서버(`private.extract_refs`)와 화면이 같은 자리를 그대로 읽는다.
 *
 * 노드와 마크의 이름·속성은 DB 함수와 편집기 스키마(`features/editor/model/schema.ts`)가 함께 쓴다.
 * 이름을 바꾸면 세 곳을 같이 고친다.
 */

export interface WikiMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface WikiNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: WikiNode[];
  marks?: WikiMark[];
  text?: string;
}

/** 문서 단위 정보. 본문 흐름에 자리가 없는 것들이라 문서 속성에 둔다. */
export interface WikiDocAttrs {
  /** 이 문서가 속한 분류의 전체 제목(`분류:생활`). */
  categories?: string[];
  /** 넘겨주기 문서면 대상 제목. */
  redirect?: string;
}

export interface WikiDoc {
  type: "doc";
  attrs?: WikiDocAttrs;
  content: WikiNode[];
}

/** 노드 이름. 편집기 스키마·DB와 같다. */
export const NODE = {
  doc: "doc",
  paragraph: "paragraph",
  heading: "heading",
  text: "text",
  hardBreak: "hardBreak",
  bulletList: "bulletList",
  orderedList: "orderedList",
  listItem: "listItem",
  blockquote: "blockquote",
  codeBlock: "codeBlock",
  horizontalRule: "horizontalRule",
  table: "table",
  tableRow: "tableRow",
  tableHeader: "tableHeader",
  tableCell: "tableCell",
  /** 접기. `attrs.title`. */
  fold: "fold",
  /** 틀 끼워 넣기. `attrs.name`(틀 제목), `attrs.args`(값 목록). */
  template: "template",
  /** 틀 본문 안의 값 자리. `attrs.index`(1부터). */
  templateParam: "templateParam",
  /** 올린 이미지. `attrs.id`(uuid), `attrs.alt`, `attrs.size`, `attrs.align`(`model/media.ts`). */
  image: "image",
  /**
   * 유튜브 영상. `attrs.videoId`, `attrs.start`(초), `attrs.size`, `attrs.align`
   * (`model/youtube.ts`, `model/media.ts`).
   */
  youtube: "youtube",
  /** 각주. `attrs.note`(내용, 글자). */
  footnote: "footnote",
} as const;

export const MARK = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strike",
  code: "code",
  /** 바깥 주소. `attrs.href`. */
  link: "link",
  /** 위키 문서. `attrs.target`(제목, 비면 같은 문서), `attrs.section`(문단 제목). */
  wikiLink: "wikiLink",
} as const;

/** 제목 단계. `#` 하나짜리는 문서 제목 자리라 본문은 2단계부터 쓴다. */
export const HEADING_LEVELS = [2, 3, 4] as const;

export const IMAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 바깥 링크로 허용하는 주소. 그 밖의 주소(`javascript:` 등)는 링크로 그리지 않는다. */
export const SAFE_HREF = /^(https?:|mailto:)/i;

export function emptyDoc(): WikiDoc {
  return { type: "doc", content: [{ type: NODE.paragraph }] };
}

/** 넘겨주기 문서의 본문. 본문과 분류 없이 대상만 둔다(DB가 다른 모양은 거부한다). */
export function redirectDoc(target: string): WikiDoc {
  return {
    type: "doc",
    content: emptyDoc().content,
    attrs: { redirect: target },
  };
}

/** 저장된 값이 문서 모양인지. 서버가 검사하지만 화면도 낡은 값·깨진 값에 버틴다. */
export function isWikiDoc(value: unknown): value is WikiDoc {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as WikiDoc).type === "doc" &&
    Array.isArray((value as WikiDoc).content)
  );
}

/** 깨진 값이면 빈 문서로 읽는다. */
export function asWikiDoc(value: unknown): WikiDoc {
  return isWikiDoc(value) ? value : emptyDoc();
}

export function stringAttr(node: WikiNode | WikiMark, name: string): string {
  const value = node.attrs?.[name];
  return typeof value === "string" ? value : "";
}

export function numberAttr(
  node: WikiNode | WikiMark,
  name: string,
): number | null {
  const value = node.attrs?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stringListAttr(node: WikiNode, name: string): string[] {
  const value = node.attrs?.[name];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** 노드 안의 글자를 모두 이어 붙인다(제목 글자, 각주 미리보기 등). */
export function nodeText(node: WikiNode): string {
  if (node.type === NODE.text) return node.text ?? "";
  if (node.type === NODE.hardBreak) return " ";
  return (node.content ?? []).map(nodeText).join("");
}

/** 문서를 깊이 우선으로 훑는다. `visit`이 `false`를 돌려주면 그 노드의 안은 보지 않는다. */
export function walk(
  nodes: readonly WikiNode[],
  visit: (node: WikiNode) => boolean | void,
): void {
  for (const node of nodes) {
    if (visit(node) === false) continue;
    if (node.content) walk(node.content, visit);
  }
}
