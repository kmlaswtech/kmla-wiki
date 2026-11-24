import { Extension, InputRule, type AnyExtension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Placeholder } from "@tiptap/extensions";
import { ReactNodeViewRenderer } from "@tiptap/react";

import {
  Fold,
  Footnote,
  schemaExtensions,
  Template,
  WikiImage,
  Youtube,
} from "../model/schema";
import type { EditorRequest } from "./editor-ui";
import {
  FoldView,
  FootnoteView,
  ImageView,
  TemplateView,
  YoutubeView,
} from "./node-views";
import {
  MARK,
  NODE,
  pageHref,
  parseTitle,
  sectionAnchor,
  titleKey,
} from "~/features/markup";

export interface WikiEditorOptions {
  /** 툴바 밖에서 대화상자를 여는 길(`[[`, `{{`, Ctrl+K). */
  request: (request: EditorRequest) => void;
  /** 없는 문서인가. 최신 목록을 읽도록 함수로 받는다. */
  isMissing: (title: string) => boolean;
}

/**
 * 위키 문법을 외운 사람을 위한 지름길.
 *
 *  - `[[`를 치면 문서 링크 대화상자, `{{`를 치면 틀 대화상자가 열린다.
 *  - `## `, `- `, `> `, `**굵게**` 같은 마크다운 표기는 StarterKit이 그 자리에서 꾸밈으로 바꾼다.
 *
 * 괄호는 한글 조합과 상관없이 들어오는 글자라 입력기와 부딪치지 않는다.
 */
export const WikiShortcuts = Extension.create<
  Pick<WikiEditorOptions, "request">
>({
  name: "wikiShortcuts",

  addOptions() {
    return { request: () => undefined };
  },

  addInputRules() {
    const { request } = this.options;
    return [
      new InputRule({
        find: /\[\[$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).run();
          request({ kind: "link" });
        },
      }),
      new InputRule({
        find: /\{\{$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).run();
          request({ kind: "template" });
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        this.options.request({ kind: "link" });
        return true;
      },
    };
  },
});

const missingLinksKey = new PluginKey<DecorationSet>("wikiMissingLinks");

/** 링크 목록을 새로 받은 뒤 빨간 링크 표시를 다시 계산하게 한다. */
export function refreshMissingLinks(view: {
  state: EditorState;
  dispatch: (tr: EditorState["tr"]) => void;
}): void {
  view.dispatch(view.state.tr.setMeta(missingLinksKey, true));
}

/** 없는 문서로 가는 링크를 문서 보기처럼 빨갛게 보여 준다. */
const MissingLinks = Extension.create<Pick<WikiEditorOptions, "isMissing">>({
  name: "wikiMissingLinks",

  addOptions() {
    return { isMissing: () => false };
  },

  addProseMirrorPlugins() {
    const { isMissing } = this.options;
    const build = (state: EditorState) => {
      const decorations: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (!node.isText) return;
        const mark = node.marks.find(
          (item) => item.type.name === MARK.wikiLink,
        );
        const title = mark ? parseTitle(String(mark.attrs.target ?? "")) : null;
        if (title && isMissing(titleKey(title))) {
          decorations.push(
            Decoration.inline(pos, pos + node.nodeSize, {
              class: "wiki-link-missing",
            }),
          );
        }
      });
      return DecorationSet.create(state.doc, decorations);
    };

    return [
      new Plugin({
        key: missingLinksKey,
        state: {
          init: (_, state) => build(state),
          apply: (tr, old, _, state) =>
            tr.docChanged || tr.getMeta(missingLinksKey) ? build(state) : old,
        },
        props: {
          decorations: (state) => missingLinksKey.getState(state),
        },
      }),
    ];
  },
});

/**
 * 빈 캡션에 `is-empty`를 붙인다. CSS가 그 자리에 "캡션 (선택)"을 보여 적을 자리를 알린다. 기본
 * placeholder 확장은 맨 바깥 블록만 보므로 캡션에 닿지 않는다.
 */
const emptyCaptionKey = new PluginKey<DecorationSet>("wikiEmptyCaption");

const EmptyCaption = Extension.create({
  name: "wikiEmptyCaption",

  addProseMirrorPlugins() {
    // 문서를 한 번 훑는다. 캡션은 문단 같은 글자 블록 안에 없으므로 그 안으로는 내려가지 않는다.
    const build = (state: EditorState) => {
      const decorations: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name === NODE.caption) {
          if (node.content.size === 0) {
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, { class: "is-empty" }),
            );
          }
          return false;
        }
        return !node.isTextblock;
      });
      return DecorationSet.create(state.doc, decorations);
    };

    return [
      new Plugin({
        key: emptyCaptionKey,
        // 문서가 바뀔 때만 다시 센다. 커서만 움직이는 입력에서는 그대로 쓴다.
        state: {
          init: (_, state) => build(state),
          apply: (tr, old, _, state) => (tr.docChanged ? build(state) : old),
        },
        props: {
          decorations: (state) => emptyCaptionKey.getState(state),
        },
      }),
    ];
  },
});

/**
 * Ctrl+클릭(맥은 Cmd+클릭)으로 링크를 새 탭에서 연다. 그냥 클릭은 지금처럼 커서만 옮긴다.
 * 새 탭으로 여는 것은 저장하지 않은 편집 내용을 잃지 않기 위해서다.
 */
const OpenLinkOnModClick = Extension.create({
  name: "wikiOpenLinkOnModClick",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClick: (view, _pos, event) => {
            if (!(event.ctrlKey || event.metaKey) || event.button !== 0) {
              return false;
            }
            // 링크 끝이나 줄 끝 빈 곳을 눌러도 그 자리의 글자 표시가 링크라서, 위치가 아니라 실제로
            // 누른 `<a>`로 링크를 찾는다.
            const target = event.target;
            const anchor =
              target instanceof Element ? target.closest("a") : null;
            if (!anchor || !view.dom.contains(anchor)) return false;
            const href = linkHref(view.state, view.posAtDOM(anchor, 0));
            if (href === null) return false;
            window.open(href, "_blank", "noopener,noreferrer");
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});

/** 새 탭으로 열 바깥 주소. `mailto:`는 새 탭으로 열면 빈 탭이 남으므로 열지 않는다. */
const NEW_TAB_HREF = /^https?:/i;

/** `pos` 바로 뒤 글자의 링크가 가리키는 주소. 링크가 없거나 열 수 없는 주소면 `null`. */
function linkHref(state: EditorState, pos: number): string | null {
  for (const mark of state.doc.resolve(pos).nodeAfter?.marks ?? []) {
    if (mark.type.name === MARK.link) {
      const href = String(mark.attrs.href ?? "");
      return NEW_TAB_HREF.test(href) ? href : null;
    }
    if (mark.type.name === MARK.wikiLink) {
      // 같은 문서 안의 문단 링크(제목 없음)는 편집 중인 문서를 새로 열 뿐이라 열지 않는다.
      const title = parseTitle(String(mark.attrs.target ?? ""));
      if (!title) return null;
      return `${pageHref(title)}${sectionAnchor(String(mark.attrs.section ?? ""))}`;
    }
  }
  return null;
}

/** 편집 화면의 확장 전부: 스키마에 노드 뷰와 지름길을 더한다. */
export function editorExtensions(options: WikiEditorOptions): AnyExtension[] {
  const views = new Map<string, AnyExtension>([
    [
      Fold.name,
      Fold.extend({ addNodeView: () => ReactNodeViewRenderer(FoldView) }),
    ],
    [
      Template.name,
      Template.extend({
        addNodeView: () => ReactNodeViewRenderer(TemplateView),
      }),
    ],
    [
      WikiImage.name,
      WikiImage.extend({ addNodeView: () => ReactNodeViewRenderer(ImageView) }),
    ],
    [
      Youtube.name,
      Youtube.extend({ addNodeView: () => ReactNodeViewRenderer(YoutubeView) }),
    ],
    [
      Footnote.name,
      Footnote.extend({
        addNodeView: () => (props) => {
          const view = ReactNodeViewRenderer(FootnoteView, { as: "span" })(
            props,
          );
          // 각주 내용은 대화상자에서 고친다. 본문에는 번호만 그리고, 내용 자리(contentDOM)는 두지
          // 않는다. React 노드 뷰는 내용이 있는 노드에 내용 자리를 저절로 붙이므로 여기서 뗀다.
          (view as { contentDOM?: HTMLElement | null }).contentDOM?.remove();
          Object.defineProperty(view, "contentDOM", { value: null });
          return view;
        },
      }),
    ],
  ]);

  return [
    ...schemaExtensions().map(
      (extension) => views.get(extension.name) ?? extension,
    ),
    Placeholder.configure({
      placeholder: "본문을 입력하세요.",
    }),
    WikiShortcuts.configure({ request: options.request }),
    MissingLinks.configure({ isMissing: options.isMissing }),
    OpenLinkOnModClick,
    EmptyCaption,
  ];
}
