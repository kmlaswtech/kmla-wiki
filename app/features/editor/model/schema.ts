import {
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
import { StarterKit } from "@tiptap/starter-kit";

import {
  DEFAULT_VIDEO_SIZE,
  HEADING_LEVELS,
  IMAGE_ID,
  MARK,
  isMediaAlign,
  isMediaSize,
  NODE,
  normalizeStart,
  SAFE_HREF,
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

/** 각주. 내용은 글자 하나(`note`)이고 본문에는 번호만 보인다. */
export const Footnote = Node.create({
  name: NODE.footnote,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      note: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-note") ?? "",
        renderHTML: (attributes) => ({ "data-note": attributes.note }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-footnote]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "sup",
      mergeAttributes(HTMLAttributes, {
        "data-footnote": "",
        class: "wiki-footnote-ref",
      }),
    ];
  },

  renderText({ node }) {
    return `[* ${String(node.attrs.note ?? "")}]`;
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
 * 이미지·영상의 크기·정렬·캡션 속성. 문서 보기(`WikiContent`)가 `data-size`·`data-align`과
 * `<figcaption>`으로 남기므로 복사해 붙여넣어도 살아난다. 모르는 값은 버린다.
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
    // 그림 아래에 보이는 글. 비어 있으면 보이지 않는다.
    caption: {
      default: "",
      parseHTML: (element: HTMLElement) =>
        element.getAttribute("data-caption") ??
        element.querySelector(":scope figcaption")?.textContent?.trim() ??
        "",
      rendered: false,
    },
  };
}

/**
 * 크기·정렬·캡션을 HTML로 남긴다. 편집기 안에서 잘라내 붙여넣을 때(클립보드 HTML은 `renderHTML`로
 * 만든다) 고른 값이 사라지지 않게 한다.
 */
function mediaDataAttributes(attrs: Record<string, unknown>) {
  return {
    "data-size": attrs.size,
    "data-align": attrs.align,
    "data-caption": attrs.caption || null,
  };
}

/** 위키에 올린 이미지. 바깥 주소의 이미지는 받지 않는다(붙여넣어도 버린다). */
export const WikiImage = Node.create({
  name: NODE.image,
  group: "block",
  atom: true,
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
      `[이미지: ${String(node.attrs.alt || node.attrs.id)}]`,
    ];
  },
});

/** 유튜브 영상. 주소가 아니라 영상 id와 시작 시각만 저장한다(`markup/model/youtube.ts`). */
export const Youtube = Node.create({
  name: NODE.youtube,
  group: "block",
  atom: true,
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
      `[유튜브: ${String(node.attrs.videoId)}]`,
    ];
  },
});

/**
 * 스키마를 이루는 확장 전부. 꾸밈 단추로 고를 수 있는 것만 넣는다. 여기에 없는 꾸밈(글자 색·크기,
 * 정렬)은 붙여넣어도 사라진다.
 */
export function schemaExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [...HEADING_LEVELS] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        isAllowedUri: (url) => SAFE_HREF.test(url),
        HTMLAttributes: {
          target: "_blank",
          rel: "noopener noreferrer nofollow",
          class: null,
        },
      },
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    WikiLink,
    Footnote,
    Fold,
    Template,
    TemplateParam,
    WikiImage,
    Youtube,
  ];
}

let schema: ReturnType<typeof getSchema> | undefined;

/** 저장된 값을 정리할 때 쓰는 스키마. 편집기와 같은 정의에서 만든다. */
export function wikiSchema() {
  schema ??= getSchema(schemaExtensions());
  return schema;
}
