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
import { MARK, parseTitle, titleKey } from "~/features/markup";

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
const WikiShortcuts = Extension.create<Pick<WikiEditorOptions, "request">>({
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
        addNodeView: () => ReactNodeViewRenderer(FootnoteView, { as: "span" }),
      }),
    ],
  ]);

  return [
    ...schemaExtensions().map(
      (extension) => views.get(extension.name) ?? extension,
    ),
    Placeholder.configure({
      placeholder:
        "여기에 내용을 씁니다. 제목은 ## , 목록은 - 로 시작해도 됩니다.",
    }),
    WikiShortcuts.configure({ request: options.request }),
    MissingLinks.configure({ isMissing: options.isMissing }),
  ];
}
