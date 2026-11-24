import {
  Extension,
  getSchema,
  Mark,
  mergeAttributes,
  Node,
  type AnyExtension,
} from "@tiptap/core";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import {
  DOMParser,
  DOMSerializer,
  Fragment,
  Slice,
  type Node as PMNode,
  type ResolvedPos,
} from "@tiptap/pm/model";
import {
  Plugin,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { ReplaceAroundStep, ReplaceStep } from "@tiptap/pm/transform";
import { StarterKit } from "@tiptap/starter-kit";

import {
  backgroundVars,
  DEFAULT_VIDEO_SIZE,
  HEADING_LEVELS,
  IMAGE_ID,
  isCellVAlign,
  isMediaAlign,
  isMediaSize,
  isTextAlign,
  isTextSize,
  MARK,
  NODE,
  normalizeStart,
  parseBackground,
  parseTextColor,
  SAFE_HREF,
  styleText,
  textColorVars,
  YOUTUBE_ID,
  type MediaSize,
} from "~/features/markup";

/**
 * 편집기 스키마: 문서에 들어갈 수 있는 노드와 마크.
 *
 * 저장되는 JSON의 모양이 여기서 정해진다. 이름과 속성은 `features/markup/model/doc.ts`와 DB 함수
 * (`private.extract_refs` 등)가 같은 것을 쓴다.
 *
 * 여기 있는 정의는 React를 모른다. 화면 조각(노드 뷰)은 `components/extensions.ts`가 덧붙인다. 그래서
 * 이 파일만으로 스키마를 만들어 저장된 값을 정리(`model/doc-io.ts`)할 수 있다.
 *
 * `parseHTML` 규칙은 붙여넣기에 쓴다. 문서 보기 화면(`WikiContent`)이 남기는 `data-*` 속성을 읽어,
 * 다른 문서를 복사해 붙여넣어도 위키 링크·각주·접기가 그대로 살아난다.
 */

/** 위키 문서 링크. 바깥 링크와 따로 둔다(주소가 아니라 제목을 가리킨다). */
export const WikiLink = Mark.create({
  name: MARK.wikiLink,
  // 굵게 등보다 바깥에 놓인다.
  priority: 1000,
  inclusive: false,
  excludes: MARK.link,

  addAttributes() {
    return {
      // `<a target>`은 HTML에서 다른 뜻이라 속성을 그대로 내보내지 않는다.
      target: { default: "", rendered: false },
      section: { default: "", rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-wiki-target]",
        getAttrs: (element) => ({
          target: element.getAttribute("data-wiki-target") ?? "",
          section: element.getAttribute("data-wiki-section") ?? "",
        }),
      },
    ];
  },

  renderHTML({ mark, HTMLAttributes }) {
    const target = String(mark.attrs.target ?? "");
    const section = String(mark.attrs.section ?? "");
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        class: "wiki-link",
        "data-wiki-target": target,
        "data-wiki-section": section || null,
        title: section ? `${target}#${section}` : target,
      }),
      0,
    ];
  },
});

/**
 * 각주 안에 들어갈 수 있는 것. 글자(모든 꾸밈), 줄바꿈, 틀 문서의 값 자리다. 블록과 각주 안의 각주는
 * 넣지 않는다. 각주는 본문의 `[n]` 팝오버와 문서 아래 목록 한 줄로 보이기 때문이다.
 */
export const FOOTNOTE_CONTENT = `(${NODE.text} | ${NODE.hardBreak} | ${NODE.templateParam})*`;

/** 각주 내용의 글자. 줄바꿈은 띄어쓰기로, 값 자리는 `{{{n}}}`로 적는다(툴팁, 복사한 글자). */
export function footnoteText(node: PMNode): string {
  return node.textBetween(0, node.content.size, " ", (leaf) =>
    leaf.type.name === NODE.templateParam
      ? `{{{${String(leaf.attrs.index ?? 1)}}}}`
      : " ",
  );
}

/**
 * 각주. 내용은 노드 내용(`content`)이고 본문에는 번호만 보인다.
 *
 * `atom`이라 본문 안에서 커서가 들어가지 않는다. 내용은 대화상자의 작은 편집기에서 고친다.
 */
export const Footnote = Node.create({
  name: NODE.footnote,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  content: FOOTNOTE_CONTENT,

  parseHTML() {
    return [
      {
        tag: "sup[data-footnote]",
        // 내용은 `data-footnote-content`의 JSON에서 되살린다. 이 값은 HTML 규칙을 거치지 않으므로,
        // 한 번 HTML로 그렸다가 다시 읽어 다른 붙여넣기와 같은 검사(주소, 팔레트, 글자 크기)를 받게
        // 한다. 각주에 넣을 수 없는 블록은 이때 풀린다.
        getContent: (element, schema) => {
          if (!(element instanceof HTMLElement)) return Fragment.empty;
          const raw = element.getAttribute("data-footnote-content");
          if (!raw) return Fragment.empty;
          try {
            const html = DOMSerializer.fromSchema(schema).serializeFragment(
              Fragment.fromJSON(schema, JSON.parse(raw)),
              { document: element.ownerDocument },
            );
            const holder = element.ownerDocument.createElement("div");
            holder.append(html);
            return DOMParser.fromSchema(schema).parse(holder, {
              topNode: schema.nodes[NODE.footnote]!.create(),
            }).content;
          } catch {
            return Fragment.empty;
          }
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    // 내용 자리(0)를 두지 않는다. 복사할 때 내용은 속성에 실려 간다.
    return [
      "sup",
      mergeAttributes(HTMLAttributes, {
        "data-footnote": "",
        "data-footnote-content": JSON.stringify(node.content.toJSON() ?? []),
        class: "wiki-footnote-ref",
      }),
    ];
  },

  renderText({ node }) {
    return `[* ${footnoteText(node)}]`;
  },
});

/** 접기. 제목은 속성, 안의 내용은 보통 블록이다. */
export const Fold = Node.create({
  name: NODE.fold,
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      title: {
        default: "",
        parseHTML: (element) =>
          element.querySelector(":scope > summary")?.textContent?.trim() ?? "",
        rendered: false,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "details",
        contentElement: (element) => {
          const body = element.cloneNode(true) as HTMLElement;
          body.querySelector(":scope > summary")?.remove();
          return body;
        },
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "details",
      { open: "", "data-fold": "" },
      ["summary", {}, String(node.attrs.title || "펼치기")],
      ["div", { "data-fold-body": "" }, 0],
    ];
  },
});

/** 틀 끼워 넣기. 편집기 안에서는 틀 본문을 펼쳐 보여 주되, 직접 고치지는 않는다. */
export const Template = Node.create({
  name: NODE.template,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      name: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-name") ?? "",
        rendered: false,
      },
      args: {
        default: [],
        parseHTML: (element) => {
          try {
            const value: unknown = JSON.parse(
              element.getAttribute("data-args") ?? "[]",
            );
            return Array.isArray(value) ? value.map(String) : [];
          } catch {
            return [];
          }
        },
        rendered: false,
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-template]" }];
  },

  renderHTML({ node }) {
    const args = (node.attrs.args as string[] | undefined) ?? [];
    return [
      "div",
      {
        "data-template": "",
        "data-name": node.attrs.name,
        "data-args": JSON.stringify(args),
      },
      `{{${String(node.attrs.name)}${args.map((arg) => `|${arg}`).join("")}}}`,
    ];
  },
});

/** 틀 본문 안의 값 자리(`{{{1}}}`). 틀을 쓰는 문서에서 넘긴 값으로 바뀐다. */
export const TemplateParam = Node.create({
  name: NODE.templateParam,
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      index: {
        default: 1,
        parseHTML: (element) =>
          Number(element.getAttribute("data-template-param")) || 1,
        rendered: false,
      },
    };
  },

  parseHTML() {
    return [{ tag: "code[data-template-param]" }];
  },

  renderHTML({ node }) {
    return [
      "code",
      { "data-template-param": String(node.attrs.index) },
      `{{{${String(node.attrs.index)}}}}`,
    ];
  },

  renderText({ node }) {
    return `{{{${String(node.attrs.index)}}}}`;
  },
});

/**
 * 이미지·영상의 크기·정렬 속성. 문서 보기(`WikiContent`)가 `data-size`·`data-align`으로 남기므로
 * 복사해 붙여넣어도 살아난다. 모르는 값은 버린다.
 */
function mediaAttributes(defaultSize: MediaSize | null) {
  return {
    size: {
      default: defaultSize,
      parseHTML: (element: HTMLElement) => {
        const value = element.getAttribute("data-size");
        return isMediaSize(value) ? value : defaultSize;
      },
      rendered: false,
    },
    align: {
      default: "left",
      parseHTML: (element: HTMLElement) => {
        const value = element.getAttribute("data-align");
        return isMediaAlign(value) ? value : "left";
      },
      rendered: false,
    },
  };
}

/**
 * 크기·정렬을 HTML로 남긴다. 편집기 안에서 잘라내 붙여넣을 때(클립보드 HTML은 `renderHTML`로
 * 만든다) 고른 값이 사라지지 않게 한다.
 */
function mediaDataAttributes(attrs: Record<string, unknown>) {
  return { "data-size": attrs.size, "data-align": attrs.align };
}

/**
 * 붙여넣은 `<figure>`에서 캡션만 내용으로 읽는다. 문서 보기의 상자에는 그림과 다른 글자(불러오는 중
 * 표시 등)도 있는데, 그것이 캡션에 섞이지 않게 한다. 캡션이 없으면 빈 캡션이 채워진다.
 */
function captionElement(element: HTMLElement): HTMLElement {
  const box = element.ownerDocument.createElement("div");
  const caption = element.querySelector("figcaption");
  if (caption) box.append(caption.cloneNode(true));
  return box;
}

/**
 * 캡션 안에 들어갈 수 있는 것: 각주 내용에 각주를 더한 것. 표·이미지 같은 블록은 넣지 않는다.
 * 각주 내용에는 이미지가 들어가지 않으므로 각주 안에 각주가 생기지 않는다.
 */
export const CAPTION_CONTENT = `(${NODE.text} | ${NODE.hardBreak} | ${NODE.footnote} | ${NODE.templateParam})*`;

const MEDIA_TYPES: readonly string[] = [NODE.image, NODE.youtube];

/** 이 위치를 감싼 이미지·영상의 깊이. 없으면 `null`. */
function mediaDepth($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (MEDIA_TYPES.includes($pos.node(depth).type.name)) return depth;
  }
  return null;
}

/**
 * 이미지·영상 안을 고치는 단계가 캡션 글자만 바꾸는가. 캡션 안에서 블록을 넣으면(툴바의 표·이미지
 * 단추 등) ProseMirror가 이미지를 둘로 갈라 같은 그림이 두 번 생긴다. 그런 단계를 막는다. 그림
 * 상자 밖에서 시작하거나 끝나는 단계(그림째로 지우기 등)는 막지 않는다.
 */
export function keepsMediaShape(tr: Transaction): boolean {
  return tr.steps.every((step, index) => {
    if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) {
      return true;
    }
    const doc = tr.docs[index]!;
    const $from = doc.resolve(step.from);
    const depth = mediaDepth($from);
    if (depth === null) return true;
    const $to = doc.resolve(step.to);
    if ($to.depth < depth || $to.start(depth) !== $from.start(depth)) {
      return true;
    }
    // 캡션 속성(띠 배경)만 바꾸는 단계(`setNodeMarkup`)는 내용을 그대로 두고 캡션 노드만 바꾼다.
    if (step instanceof ReplaceAroundStep) return isCaptionMarkup(step);
    const { slice } = step;
    if (slice.openStart > 0 || slice.openEnd > 0) return false;
    let ok = true;
    slice.content.forEach((node) => {
      if (!node.isInline && node.type.name !== NODE.caption) ok = false;
    });
    return ok;
  });
}

/** 캡션 노드 하나를 같은 내용의 캡션 노드로 바꾸는 단계인가(속성만 바뀐다). */
function isCaptionMarkup(step: ReplaceAroundStep): boolean {
  const { slice } = step;
  return (
    step.insert === 1 &&
    step.gapFrom === step.from + 1 &&
    step.gapTo === step.to - 1 &&
    slice.openStart === 0 &&
    slice.openEnd === 0 &&
    slice.content.childCount === 1 &&
    slice.content.firstChild!.type.name === NODE.caption
  );
}

/** 캡션에 붙여넣은 여러 문단을 줄바꿈으로 잇고, 캡션에 넣을 수 있는 것만 남긴다. */
function flattenForCaption(slice: Slice, state: EditorState): Slice | null {
  const caption = state.schema.nodes[NODE.caption]!;
  const hardBreak = state.schema.nodes[NODE.hardBreak]!;
  const allowed = (node: PMNode) =>
    caption.contentMatch.matchType(node.type) !== null;
  const pieces: PMNode[] = [];
  slice.content.descendants((node) => {
    if (node.isTextblock) {
      if (pieces.length > 0) pieces.push(hardBreak.create());
      node.forEach((child) => {
        if (allowed(child)) pieces.push(child);
      });
      return false;
    }
    if (node.isInline) {
      if (allowed(node)) pieces.push(node);
      return false;
    }
    return true;
  });
  return pieces.length > 0 ? new Slice(Fragment.from(pieces), 0, 0) : null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mediaCaption: {
      /**
       * 커서가 캡션 안에 있으면 그림 바로 아래에 빈 문단을 만들어 옮겨 간다. 캡션 밖이면 아무것도
       * 하지 않는다. 블록(표, 접기 등)을 넣는 명령 앞에 둔다. 캡션 안에는 블록이 들어가지 않는다.
       */
      leaveCaption: () => ReturnType;
    };
  }
}

/**
 * 이미지·영상 아래의 글. 본문처럼 그 자리에서 고치고, 툴바의 꾸밈·링크·각주가 듣는다. 블록
 * 무리(`block`)에 넣지 않아 이미지·영상 안에만 있다.
 */
export const MediaCaption = Node.create({
  name: NODE.caption,
  content: CAPTION_CONTENT,
  // Enter를 기본 동작(문단 나누기)보다 먼저 받는다.
  priority: 1000,

  addAttributes() {
    // 띠 배경. 표 칸 배경과 같은 값·팔레트다. 고르지 않으면 기본 띠 색이다.
    return { ...cellBackground };
  },

  parseHTML() {
    // 이미지·영상 밖의 `<figcaption>`(다른 사이트)은 이 규칙이 맞지 않아 그냥 글자로 읽는다.
    return [{ tag: "figcaption", context: `${NODE.image}/|${NODE.youtube}/` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "figcaption",
      mergeAttributes(HTMLAttributes, { class: "wiki-media-caption" }),
      0,
    ];
  },

  addCommands() {
    return {
      leaveCaption:
        () =>
        ({ tr, dispatch }) => {
          const { $from } = tr.selection;
          if ($from.parent.type.name !== NODE.caption) return true;
          if (dispatch) {
            const after = $from.after($from.depth - 1);
            tr.insert(
              after,
              tr.doc.type.schema.nodes[NODE.paragraph]!.create(),
            );
            tr.setSelection(TextSelection.create(tr.doc, after + 1));
            tr.scrollIntoView();
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // 캡션은 문단 하나다. Enter는 그림 바로 아래에 새 문단을 만들어 옮겨 간다. 캡션 안의
      // 줄바꿈은 Shift+Enter다.
      Enter: ({ editor }) =>
        editor.state.selection.$from.parent.type.name === NODE.caption &&
        editor.commands.leaveCaption(),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction: (tr) => !tr.docChanged || keepsMediaShape(tr),
        props: {
          handlePaste: (view, _event, slice) => {
            const { $from, $to } = view.state.selection;
            if ($from.parent.type.name !== NODE.caption) return false;
            if (!$to.sameParent($from)) return false;
            const flat = flattenForCaption(slice, view.state);
            if (flat) view.dispatch(view.state.tr.replaceSelection(flat));
            return true;
          },
        },
      }),
    ];
  },
});

/** 위키에 올린 이미지. 바깥 주소의 이미지는 받지 않는다(붙여넣어도 버린다). */
export const WikiImage = Node.create({
  name: NODE.image,
  group: "block",
  content: NODE.caption,
  // 캡션 안의 지우기·합치기가 그림 밖으로 넘어가지 않게 한다.
  isolating: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: "", rendered: false },
      alt: { default: "", rendered: false },
      // 고르지 않으면 올린 원본 크기다.
      ...mediaAttributes(null),
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-wiki-image]",
        getAttrs: (element) => {
          const id = element.getAttribute("data-wiki-image") ?? "";
          return IMAGE_ID.test(id)
            ? { id, alt: element.getAttribute("data-alt") ?? "" }
            : false;
        },
        contentElement: captionElement,
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "figure",
      {
        "data-wiki-image": node.attrs.id,
        "data-alt": node.attrs.alt,
        ...mediaDataAttributes(node.attrs),
      },
      0,
    ];
  },
});

/** 유튜브 영상. 주소가 아니라 영상 id와 시작 시각만 저장한다(`markup/model/youtube.ts`). */
export const Youtube = Node.create({
  name: NODE.youtube,
  group: "block",
  content: NODE.caption,
  isolating: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      videoId: { default: "", rendered: false },
      start: { default: 0, rendered: false },
      // 크기는 늘 적는다. 영상에는 원본 크기가 없다.
      ...mediaAttributes(DEFAULT_VIDEO_SIZE),
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-youtube]",
        getAttrs: (element) => {
          const videoId = element.getAttribute("data-youtube") ?? "";
          const start = normalizeStart(
            Number(element.getAttribute("data-start")),
          );
          return YOUTUBE_ID.test(videoId) ? { videoId, start } : false;
        },
        contentElement: captionElement,
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "figure",
      {
        "data-youtube": node.attrs.videoId,
        "data-start": String(node.attrs.start ?? 0),
        ...mediaDataAttributes(node.attrs),
      },
      0,
    ];
  },
});

/**
 * 글자 색. 팔레트 이름이나 검사한 `#rrggbb`만 받는다(`markup/model/style.ts`). 붙여넣기는 문서
 * 보기가 남기는 `data-text-color`만 읽는다. 다른 사이트의 `style="color: …"`는 버린다. 어두운
 * 화면에서 읽히지 않는 색이 섞여 들어오지 않게 하려는 것이다.
 */
export const TextColor = Mark.create({
  name: MARK.textColor,

  addAttributes() {
    return { color: { default: null, rendered: false } };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-text-color]",
        getAttrs: (element) => {
          const color = element.getAttribute("data-text-color");
          return parseTextColor(color) ? { color } : false;
        },
      },
    ];
  },

  renderHTML({ mark }) {
    const color = parseTextColor(mark.attrs.color);
    return [
      "span",
      {
        class: "wiki-color",
        "data-text-color": color ? String(mark.attrs.color) : null,
        style: color ? styleText(textColorVars(color)) : null,
      },
      0,
    ];
  },
});

/** 글자 크기 단계(`markup/model/style.ts`). 붙여넣기는 `data-text-size`만 읽는다. */
export const TextSize = Mark.create({
  name: MARK.textSize,

  addAttributes() {
    return { size: { default: null, rendered: false } };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-text-size]",
        getAttrs: (element) => {
          const size = Number(element.getAttribute("data-text-size"));
          return isTextSize(size) ? { size } : false;
        },
      },
    ];
  },

  renderHTML({ mark }) {
    return [
      "span",
      {
        "data-text-size": isTextSize(mark.attrs.size)
          ? String(mark.attrs.size)
          : null,
      },
      0,
    ];
  },
});

/** 문단·제목 정렬(가운데, 오른쪽). 왼쪽은 값을 두지 않는다(`null`). */
const paragraphAlign = {
  textAlign: {
    default: null,
    parseHTML: (element: HTMLElement) => {
      const value =
        element.getAttribute("data-text-align") ?? element.style.textAlign;
      return isTextAlign(value) ? value : null;
    },
    renderHTML: (attributes: Record<string, unknown>) =>
      isTextAlign(attributes.textAlign)
        ? {
            "data-text-align": attributes.textAlign,
            style: `text-align: ${attributes.textAlign}`,
          }
        : {},
  },
};

export const TextAlign = Extension.create({
  name: "wikiTextAlign",

  addGlobalAttributes() {
    return [
      { types: [NODE.paragraph, NODE.heading], attributes: paragraphAlign },
    ];
  },
});

/** 셀 배경. 이미지·영상 캡션의 띠 배경도 같은 정의를 쓴다. */
const cellBackground = {
  background: {
    default: null,
    parseHTML: (element: HTMLElement) => {
      const value = element.getAttribute("data-bg");
      return parseBackground(value) ? value : null;
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const background = parseBackground(attributes.background);
      if (!background) return {};
      const { vars, strong } = backgroundVars(background);
      return {
        "data-bg": attributes.background,
        "data-bg-strong": strong ? "" : null,
        style: styleText(vars),
      };
    },
  },
};

/**
 * 셀 세로 정렬. 위(기본)는 저장하지 않는다. 다른 사이트에서 붙여넣은 표의 `vertical-align`도 받는다.
 * 값이 위·가운데·아래뿐이라 색과 달리 화면 모드별 대비 문제가 없다.
 */
const cellVerticalAlign = {
  verticalAlign: {
    default: null,
    // 문서 보기도 같은 스타일을 쓴다. 옛 HTML 속성(`valign`)은 Word·Excel 표가 쓴다. `data-bg`와 달리
    // 스타일에서 값을 그대로 되읽을 수 있으므로 `data-*`를 따로 두지 않는다.
    parseHTML: (element: HTMLElement) =>
      [element.style.verticalAlign, element.getAttribute("valign")].find(
        isCellVAlign,
      ) ?? null,
    renderHTML: (attributes: Record<string, unknown>) =>
      isCellVAlign(attributes.verticalAlign)
        ? { style: `vertical-align: ${attributes.verticalAlign}` }
        : {},
  },
};

/**
 * 셀 속성: Tiptap 셀 속성에서 가로 정렬(`align`)을 빼고 배경과 세로 정렬을 더한다. 칸 안의 글도
 * 문단이라 가로는 문단 정렬로 맞춘다. 정렬을 두 곳에 두면 둘이 어긋날 때 어느 것이 이기는지 알기
 * 어렵다. 세로 정렬은 문단에 없으므로 칸에 둔다.
 */
function cellAttributes(parent: Record<string, unknown> | undefined) {
  const { align: _align, ...rest } = parent ?? {};
  return { ...rest, ...cellBackground, ...cellVerticalAlign };
}

/**
 * 문단·셀·캡션 꾸밈 속성의 이름. 기본값 `null`은 "고르지 않음"이라 저장할 때 뺀다(`doc-io.ts`).
 * 꾸밈 속성을 더하면 그 정의를 여기에도 넣는다.
 */
export const STYLE_ATTRS: readonly string[] = Object.keys({
  ...paragraphAlign,
  ...cellBackground,
  ...cellVerticalAlign,
});

export const WikiTableCell = TableCell.extend({
  addAttributes() {
    return cellAttributes(this.parent?.());
  },
});

export const WikiTableHeader = TableHeader.extend({
  addAttributes() {
    return cellAttributes(this.parent?.());
  },
});

/** 바깥 링크. 본문 편집기와 각주 편집기가 같이 쓴다. */
const LINK_OPTIONS = {
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  defaultProtocol: "https",
  isAllowedUri: (url: string) => SAFE_HREF.test(url),
  HTMLAttributes: {
    target: "_blank",
    rel: "noopener noreferrer nofollow",
    class: null,
  },
};

/**
 * 각주 편집기의 스키마. 문서는 문단 하나이고, 그 문단의 내용이 각주 내용이 된다.
 *
 * 꾸밈(mark)은 본문 편집기와 같은 정의를 쓴다. 그래서 두 편집기 사이에서 내용을 옮길 때 바꿀 것이
 * 없다. 본문의 꾸밈을 더하면 여기에도 더한다.
 */
export function footnoteExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      document: false,
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      codeBlock: false,
      horizontalRule: false,
      trailingNode: false,
      link: LINK_OPTIONS,
    }),
    Node.create({ name: "doc", topNode: true, content: NODE.paragraph }),
    TextColor,
    TextSize,
    WikiLink,
    TemplateParam,
  ];
}

/**
 * 스키마를 이루는 확장 전부. 꾸밈 단추로 고를 수 있는 것만 넣는다. 여기에 없는 꾸밈(글꼴, 줄 간격
 * 등)과 팔레트·검사를 거치지 않은 값은 붙여넣어도 사라진다.
 */
export function schemaExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [...HEADING_LEVELS] },
      link: LINK_OPTIONS,
    }),
    Table.configure({ resizable: false }),
    TableRow,
    WikiTableHeader,
    WikiTableCell,
    TextAlign,
    TextColor,
    TextSize,
    WikiLink,
    Footnote,
    Fold,
    Template,
    TemplateParam,
    WikiImage,
    Youtube,
    MediaCaption,
  ];
}

let schema: ReturnType<typeof getSchema> | undefined;

/** 저장된 값을 정리할 때 쓰는 스키마. 편집기와 같은 정의에서 만든다. */
export function wikiSchema() {
  schema ??= getSchema(schemaExtensions());
  return schema;
}
