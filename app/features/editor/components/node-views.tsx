import {
  NodeViewContent,
  NodeViewWrapper,
  type ReactNodeViewProps,
} from "@tiptap/react";
import { ChevronDown, Pencil, Puzzle } from "lucide-react";
import { useMemo } from "react";

import { useEditorUi } from "./editor-ui";
import { WikiImage } from "~/features/images";
import {
  baseName,
  NODE,
  parseWiki,
  templateTitle,
  WikiContent,
  type WikiDoc,
} from "~/features/markup";
import { cn } from "~/shared/lib/utils";

/** 접기: 제목 칸과, 그 아래 바로 고칠 수 있는 내용. 편집 중에는 늘 펼쳐 둔다. */
export function FoldView({
  node,
  updateAttributes,
  editor,
}: ReactNodeViewProps) {
  return (
    <NodeViewWrapper className="wiki-fold-edit" data-fold="">
      <div
        contentEditable={false}
        className="flex items-center gap-1.5 border-b px-1 pb-1.5"
      >
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <input
          type="text"
          value={String(node.attrs.title ?? "")}
          placeholder="접기 제목"
          aria-label="접기 제목"
          readOnly={!editor.isEditable}
          onChange={(event) => updateAttributes({ title: event.target.value })}
          className="min-w-0 flex-1 bg-transparent font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground"
        />
      </div>
      <NodeViewContent className="wiki-fold-body" />
    </NodeViewWrapper>
  );
}

/**
 * 틀: 지금 틀 본문을 펼쳐 보여 준다. 글은 틀 문서에서 고치므로 여기서는 이름과 값만 바꾼다.
 */
export function TemplateView({
  node,
  selected,
  getPos,
  editor,
}: ReactNodeViewProps) {
  const { resolved, images, request } = useEditorUi();
  const name = String(node.attrs.name ?? "");
  const args = (node.attrs.args as string[] | undefined) ?? [];
  const argsKey = JSON.stringify(args);
  const title = templateTitle(name);

  const document = useMemo(() => {
    const doc: WikiDoc = {
      type: "doc",
      content: [
        {
          type: NODE.template,
          attrs: { name, args: JSON.parse(argsKey) as string[] },
        },
      ],
    };
    return parseWiki(doc, { templates: resolved.templates });
  }, [name, argsKey, resolved.templates]);

  return (
    <NodeViewWrapper
      className={cn("wiki-template-edit", selected && "ring-1 ring-ring/60")}
      data-drag-handle=""
    >
      <div
        contentEditable={false}
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Puzzle className="size-3.5" aria-hidden />
        <span className="font-medium">
          틀: {title ? baseName(title) : name}
        </span>
        {args.length > 0 ? (
          <span className="truncate">({args.join(", ")})</span>
        ) : null}
        {editor.isEditable ? (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
            onClick={() => {
              const pos = getPos();
              if (typeof pos === "number") request({ kind: "template", pos });
            }}
          >
            <Pencil className="size-3" aria-hidden />
            고치기
          </button>
        ) : null}
      </div>
      <div contentEditable={false} className="pointer-events-none select-none">
        <WikiContent
          document={document}
          existing={resolved.existing}
          renderImage={(id, alt) => (
            <WikiImage info={images.get(id)} alt={alt} />
          )}
          embedded
        />
      </div>
    </NodeViewWrapper>
  );
}

/** 올린 이미지와 그 설명. 설명은 화면 낭독기가 읽는다. */
export function ImageView({
  node,
  selected,
  updateAttributes,
  editor,
}: ReactNodeViewProps) {
  const { images } = useEditorUi();
  const id = String(node.attrs.id ?? "");
  const alt = String(node.attrs.alt ?? "");

  return (
    <NodeViewWrapper
      className={cn("wiki-image-edit", selected && "ring-1 ring-ring/60")}
      data-drag-handle=""
    >
      <div contentEditable={false}>
        <WikiImage info={images.get(id)} alt={alt} />
        <input
          type="text"
          value={alt}
          placeholder="이미지 설명 (무엇을 찍은 사진인지)"
          aria-label="이미지 설명"
          readOnly={!editor.isEditable}
          onChange={(event) => updateAttributes({ alt: event.target.value })}
          className="mt-1 w-full max-w-md bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/70"
        />
      </div>
    </NodeViewWrapper>
  );
}

/** 각주 번호. 번호는 CSS가 차례대로 매긴다. 누르면 내용을 고친다. */
export function FootnoteView({
  node,
  selected,
  getPos,
  editor,
}: ReactNodeViewProps) {
  const { request } = useEditorUi();
  const note = String(node.attrs.note ?? "");
  return (
    <NodeViewWrapper
      as="sup"
      className={cn(
        "wiki-footnote-ref",
        selected && "rounded-sm ring-1 ring-ring/60",
      )}
    >
      <button
        type="button"
        contentEditable={false}
        title={note || "빈 각주"}
        aria-label={`각주: ${note}`}
        className="wiki-footnote-number"
        onClick={() => {
          if (!editor.isEditable) return;
          const pos = getPos();
          if (typeof pos === "number") request({ kind: "footnote", pos });
        }}
      />
    </NodeViewWrapper>
  );
}
