import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

import type { TextEdit, TextSelection } from "../model/commands";
import {
  completionInsertText,
  completionNamespacePrefix,
  findCompletionRequest,
} from "../model/completion";

export interface SourceEditorHandle {
  getValue: () => string;
  getSelection: () => TextSelection;
  /** 툴바 명령의 결과를 적용하고 편집기로 초점을 돌린다. */
  apply: (edit: TextEdit) => void;
  /** 문서 전체를 바꾼다(각주처럼 두 곳을 한 번에 고칠 때). 실행 취소 한 번으로 되돌아간다. */
  replaceAll: (doc: string, selection?: TextSelection) => void;
  focus: () => void;
}

interface SourceEditorProps {
  ref: Ref<SourceEditorHandle>;
  initialValue: string;
  onChange: (value: string) => void;
  /** 자동완성 후보를 찾는다. `prefix`는 `틀:`·`분류:` 또는 빈 문자열. */
  suggest: (query: string, prefix: string) => Promise<string[]>;
  /** 붙여넣거나 끌어놓은 이미지 파일. */
  onImageFiles?: (files: File[]) => void;
  ariaLabel: string;
}

// 색은 앱의 CSS 변수를 따른다. 밝은 테마와 어두운 테마에서 같은 설정으로 동작한다.
const theme = EditorView.theme({
  "&": {
    fontSize: "15px",
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Consolas, "Pretendard Variable", monospace',
    lineHeight: "1.7",
    minHeight: "24rem",
  },
  ".cm-content": { padding: "0.75rem", caretColor: "var(--foreground)" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
    { backgroundColor: "color-mix(in oklab, var(--primary) 25%, transparent)" },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "0.5rem",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
});

function imageFilesOf(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((file) =>
    file.type.startsWith("image/"),
  );
}

/**
 * 원문 편집기. CodeMirror를 감싸고 바깥에는 글자 편집 명령만 내놓는다.
 *
 * 저장되는 것은 사용자가 친 원문 그대로다. 보기 좋게 꾸미는 일은 미리보기가 한다.
 */
export function SourceEditor({
  ref,
  initialValue,
  onChange,
  suggest,
  onImageFiles,
  ariaLabel,
}: SourceEditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  // 편집기는 한 번만 만든다. 최신 콜백은 ref로 읽어 다시 만들지 않는다.
  const callbacks = useRef({ onChange, suggest, onImageFiles });
  useEffect(() => {
    callbacks.current = { onChange, suggest, onImageFiles };
  });
  const initial = useRef(initialValue);

  useEffect(() => {
    if (!container.current) return;

    async function complete(
      context: CompletionContext,
    ): Promise<CompletionResult | null> {
      const line = context.state.doc.lineAt(context.pos);
      const before = line.text.slice(0, context.pos - line.from);
      const request = findCompletionRequest(before);
      if (!request) return null;

      const titles = await callbacks.current.suggest(
        request.query,
        completionNamespacePrefix(request.kind),
      );
      if (context.aborted || titles.length === 0) return null;

      const after = line.text.slice(context.pos - line.from);
      return {
        from: line.from + request.from,
        // 서버가 이미 걸러 준 목록이다. 편집기가 글자 일치로 다시 거르면 `틀:` 없이 친 검색어가
        // 모두 떨어진다.
        filter: false,
        options: titles.map((title) => ({
          label: title,
          apply: completionInsertText(request, title, after),
        })),
      };
    }

    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          history(),
          // Tab은 가로채지 않는다. 키보드만 쓰는 사람이 편집기에서 빠져나갈 수 있어야 한다.
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          placeholder("여기에 내용을 씁니다."),
          autocompletion({ override: [complete], activateOnTyping: true }),
          theme,
          EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              callbacks.current.onChange(update.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            paste(event) {
              const files = imageFilesOf(event.clipboardData);
              if (files.length === 0 || !callbacks.current.onImageFiles) {
                return false;
              }
              event.preventDefault();
              callbacks.current.onImageFiles(files);
              return true;
            },
            drop(event) {
              const files = imageFilesOf(event.dataTransfer);
              if (files.length === 0 || !callbacks.current.onImageFiles) {
                return false;
              }
              event.preventDefault();
              callbacks.current.onImageFiles(files);
              return true;
            },
          }),
        ],
      }),
    });
    view.current = editor;

    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [ariaLabel]);

  useImperativeHandle(ref, () => ({
    getValue: () => view.current?.state.doc.toString() ?? initial.current,
    getSelection: () => {
      const range = view.current?.state.selection.main;
      return range ? { from: range.from, to: range.to } : { from: 0, to: 0 };
    },
    apply: (edit) => {
      const editor = view.current;
      if (!editor) return;
      editor.dispatch({
        changes: edit.change,
        selection: { anchor: edit.selection.from, head: edit.selection.to },
        scrollIntoView: true,
        userEvent: "input",
      });
      editor.focus();
    },
    replaceAll: (doc, selection) => {
      const editor = view.current;
      if (!editor) return;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: doc },
        selection: selection
          ? { anchor: selection.from, head: selection.to }
          : undefined,
        scrollIntoView: true,
        userEvent: "input",
      });
      editor.focus();
    },
    focus: () => view.current?.focus(),
  }));

  return (
    <div
      ref={container}
      className="overflow-hidden rounded-b-md border border-t-0 bg-background focus-within:ring-2 focus-within:ring-ring/50"
    />
  );
}
