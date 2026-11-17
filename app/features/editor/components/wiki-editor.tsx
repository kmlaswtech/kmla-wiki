import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useState } from "react";

import { editorExtensions, refreshMissingLinks } from "./extensions";
import {
  EditorUiContext,
  type EditorRequest,
  type EditorUi,
} from "./editor-ui";
import type { ImageInfo } from "~/features/images";
import type { WikiDoc } from "~/features/markup";
import type { ResolvedBody } from "~/features/pages";
import { cn } from "~/shared/lib/utils";

function imageFilesOf(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((file) =>
    file.type.startsWith("image/"),
  );
}

/** 바뀌는 값을 담아 두는 상자. 편집기가 렌더 밖에서(이벤트 때) 최신 값을 읽는다. */
function createBox<T>(initial: T): { current: T; update: (next: T) => void } {
  const box = {
    current: initial,
    update(next: T) {
      box.current = next;
    },
  };
  return box;
}

interface UseWikiEditorOptions {
  /** 처음 내용. 편집기는 한 번만 만든다(다른 문서로 가면 컴포넌트를 새로 만든다). */
  initialContent: WikiDoc;
  editable: boolean;
  ariaLabel: string;
  /** 링크 표시에 쓸 "있는 문서" 목록. 바뀌면 빨간 링크를 다시 칠한다. */
  existing: ReadonlySet<string>;
  request?: (request: EditorRequest) => void;
  onChange?: (content: WikiDoc) => void;
  /** 붙여넣거나 끌어놓은 이미지 파일. */
  onImageFiles?: (files: File[]) => void;
}

/**
 * 위키 편집기(Tiptap). 고치는 대로 문서 보기와 같은 모양으로 보인다.
 *
 * 바깥으로는 문서 JSON만 내놓는다. 꾸밈 명령은 툴바가 편집기에 직접 건다.
 */
export function useWikiEditor({
  initialContent,
  editable,
  ariaLabel,
  existing,
  request,
  onChange,
  onImageFiles,
}: UseWikiEditorOptions): Editor | null {
  // 편집기는 한 번만 만든다. 확장과 편집기 이벤트는 이 상자에서 최신 콜백과 목록을 읽는다
  // (편집기가 부르는 때는 렌더 밖이다).
  const [latest] = useState(() =>
    createBox({ existing, request, onChange, onImageFiles }),
  );
  useEffect(() => {
    latest.update({ existing, request, onChange, onImageFiles });
  });

  const [extensions] = useState(() =>
    editorExtensions({
      request: (next) => latest.current.request?.(next),
      isMissing: (key) => !latest.current.existing.has(key),
    }),
  );

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable,
    // 이 화면은 브라우저에서만 그려진다(SPA). 첫 렌더부터 편집기를 만든다.
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class: "wiki-content wiki-editor",
      },
      handlePaste: (_, event) => {
        const files = imageFilesOf(event.clipboardData);
        if (files.length === 0 || !latest.current.onImageFiles) return false;
        event.preventDefault();
        latest.current.onImageFiles(files);
        return true;
      },
      handleDrop: (_, event) => {
        const files = imageFilesOf(event.dataTransfer);
        if (files.length === 0 || !latest.current.onImageFiles) return false;
        event.preventDefault();
        latest.current.onImageFiles(files);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      latest.current.onChange?.(current.getJSON() as WikiDoc);
    },
  });

  // 있는 문서 목록이 새로 오면 빨간 링크를 다시 칠한다.
  useEffect(() => {
    if (editor && !editor.isDestroyed && existing) {
      refreshMissingLinks(editor.view);
    }
  }, [editor, existing]);

  return editor;
}

/** 편집기 본문. 노드 뷰(틀·이미지·각주)가 읽을 것을 함께 넘긴다. */
export function WikiEditorContent({
  editor,
  resolved,
  images,
  request,
  className,
}: {
  editor: Editor | null;
  resolved: ResolvedBody;
  images: ReadonlyMap<string, ImageInfo>;
  request?: (request: EditorRequest) => void;
  className?: string;
}) {
  // 노드 그림(틀 미리보기 등)이 이 값을 읽는다. 글자를 칠 때마다 새 값이 되면 전부 다시 그려진다.
  const ui = useMemo<EditorUi>(
    () => ({ resolved, images, request: request ?? (() => undefined) }),
    [resolved, images, request],
  );
  return (
    <EditorUiContext value={ui}>
      <EditorContent
        editor={editor}
        className={cn("wiki-editor-frame", className)}
      />
    </EditorUiContext>
  );
}

/** 고칠 수 없는 문서를 편집기 모양 그대로 보여 준다. 표·틀을 골라 복사해 다른 문서에 쓸 수 있다. */
export function ReadOnlyDocument({
  doc,
  resolved,
  images,
  ariaLabel,
}: {
  doc: WikiDoc;
  resolved: ResolvedBody;
  images: ReadonlyMap<string, ImageInfo>;
  ariaLabel: string;
}) {
  const editor = useWikiEditor({
    initialContent: { type: "doc", content: doc.content },
    editable: false,
    ariaLabel,
    existing: resolved.existing,
  });
  return (
    <WikiEditorContent
      editor={editor}
      resolved={resolved}
      images={images}
      className="rounded-md border p-4"
    />
  );
}
