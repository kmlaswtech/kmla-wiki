import type { Editor } from "@tiptap/core";
import { IdCard, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { EditorRequest } from "./editor-ui";
import { useWikiEditor, WikiEditorContent } from "./wiki-editor";
import type { ImageInfo } from "~/features/images";
import type { WikiNode } from "~/features/markup";
import type { ResolvedBody } from "~/features/pages";
import { Button } from "~/shared/ui/button";

/**
 * 프로필 편집 칸. 본문 편집기와 같은 편집기(같은 스키마, 같은 툴바)이고 자리만 따로다. 툴바는 본문과
 * 같이 쓴다. 마지막으로 초점을 받은 편집기에 꾸밈이 들어간다(`EditorForm`).
 *
 * 처음 내용으로 한 번만 만든다. 내용을 통째로 바꿀 때는 부른 쪽이 `key`를 바꿔 새로 만든다.
 */
export function ProfileEditor({
  initialProfile,
  title,
  resolved,
  images,
  request,
  onChange,
  onImageFiles,
  onEditor,
  onRemove,
}: {
  initialProfile: readonly WikiNode[];
  /** 문서 제목. 편집 영역의 이름에 쓴다. */
  title: string;
  resolved: ResolvedBody;
  images: ReadonlyMap<string, ImageInfo>;
  request: (request: EditorRequest) => void;
  onChange: (profile: WikiNode[]) => void;
  onImageFiles: (files: File[]) => void;
  /** 편집기가 생기고 없어질 때 알린다(툴바·대화상자가 이 편집기를 고를 수 있게). */
  onEditor: (editor: Editor | null) => void;
  onRemove: () => void;
}) {
  const [initialContent] = useState(() => ({
    type: "doc" as const,
    content: [...initialProfile],
  }));
  const editor = useWikiEditor({
    initialContent,
    editable: true,
    ariaLabel: `${title} 프로필`,
    existing: resolved.existing,
    request,
    onChange: (doc) => onChange(doc.content),
    onImageFiles,
    editorClassName: "wiki-profile-editor",
  });

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  return (
    <section
      aria-label="프로필"
      className="border-b border-dashed bg-muted/30 px-4 pt-2 pb-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <IdCard className="size-3.5" aria-hidden />
          프로필
        </p>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={onRemove}
        >
          <X />
          프로필 제거
        </Button>
      </div>
      <WikiEditorContent
        editor={editor}
        resolved={resolved}
        images={images}
        request={request}
        className="wiki-profile mb-0"
      />
    </section>
  );
}
