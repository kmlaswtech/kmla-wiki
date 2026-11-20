import {
  NodeViewContent,
  NodeViewWrapper,
  type ReactNodeViewProps,
} from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Pencil,
  Play,
  Puzzle,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { useEditorUi } from "./editor-ui";
import { WikiImage } from "~/features/images";
import {
  baseName,
  formatStart,
  MEDIA_ALIGN_LABEL,
  MEDIA_ALIGNS,
  MEDIA_SIZE_LABEL,
  MEDIA_SIZES,
  mediaAlign,
  mediaSize,
  NODE,
  parseWiki,
  templateTitle,
  WikiContent,
  youtubeThumbnailUrl,
  type MediaAlign,
  type MediaSize,
  type WikiDoc,
  type WikiNode,
} from "~/features/markup";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";

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
        <AttrInput
          value={String(node.attrs.title ?? "")}
          placeholder="접기 제목"
          aria-label="접기 제목"
          readOnly={!editor.isEditable}
          onCommit={(value) => updateAttributes({ title: value })}
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
          <EditNodeButton
            className="ml-auto"
            onClick={() => {
              const pos = getPos();
              if (typeof pos === "number") request({ kind: "template", pos });
            }}
          >
            틀 설정
          </EditNodeButton>
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

/**
 * 노드 속성을 고치는 한 줄 입력칸(접기 제목, 이미지 대체 텍스트, 캡션).
 *
 * 한글을 조합하는 동안에는 노드에 쓰지 않는다. 글자마다 편집기 트랜잭션을 보내면 노드 뷰가 다시
 * 그려지면서 조합 중인 글자가 씹힌다. 입력칸이 제 값을 들고 있다가 조합이 끝날 때 쓴다. 실행 취소처럼
 * 바깥에서 값이 바뀌면 조합 중이 아닐 때 따라간다.
 */
export function AttrInput({
  value,
  onCommit,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);

  useEffect(() => {
    if (!composing.current) setDraft(value);
  }, [value]);

  return (
    <input
      type="text"
      {...props}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        if (
          !composing.current &&
          !(event.nativeEvent as InputEvent).isComposing
        )
          onCommit(event.target.value);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        onCommit(event.currentTarget.value);
      }}
    />
  );
}

/** 편집기 노드의 속성을 문서 노드 꼴로 읽는다(크기·정렬 도우미가 문서 노드를 받는다). */
function asWikiNode(node: ReactNodeViewProps["node"]): WikiNode {
  return { type: node.type.name, attrs: node.attrs };
}

/** 올린 이미지와 그 대체 글. 대체 글은 화면 낭독기가 읽는다. */
export function ImageView(props: ReactNodeViewProps) {
  const { node, updateAttributes, editor } = props;
  const { images } = useEditorUi();
  const id = String(node.attrs.id ?? "");
  const alt = String(node.attrs.alt ?? "");
  const caption = String(node.attrs.caption ?? "");

  return (
    <MediaNodeView
      {...props}
      allowOriginal
      media={<WikiImage info={images.get(id)} alt={alt || caption} />}
    >
      <AttrInput
        value={alt}
        placeholder="이미지 대체 텍스트"
        aria-label="이미지 대체 텍스트"
        title="대체 텍스트를 비우면 화면 낭독기가 캡션을 읽습니다."
        readOnly={!editor.isEditable}
        onCommit={(value) => updateAttributes({ alt: value })}
        className="mt-1 w-full max-w-md bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/70"
      />
    </MediaNodeView>
  );
}

/**
 * 유튜브 영상. 편집기 안에서는 재생기 대신 미리보기 그림을 둔다. 재생기를 끼우면 끌어 옮길 때마다
 * 다시 불러오고, 누르기를 재생기가 가져가 노드를 고르기 어렵다.
 */
export function YoutubeView(props: ReactNodeViewProps) {
  const { node, getPos, editor } = props;
  const { request } = useEditorUi();
  const videoId = String(node.attrs.videoId ?? "");
  const start = Number(node.attrs.start ?? 0);

  return (
    <MediaNodeView
      {...props}
      youtube
      media={
        <span className="wiki-youtube relative">
          {videoId ? (
            <img
              src={youtubeThumbnailUrl(videoId)}
              alt=""
              className="size-full object-cover"
              draggable={false}
            />
          ) : null}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-black/60 text-white">
              <Play className="size-6 fill-current" aria-hidden />
            </span>
          </span>
        </span>
      }
    >
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          유튜브 영상{start > 0 ? ` (${formatStart(start)}부터)` : ""}
        </span>
        {editor.isEditable ? (
          <EditNodeButton
            onClick={() => {
              const pos = getPos();
              if (typeof pos === "number") request({ kind: "youtube", pos });
            }}
          >
            영상 주소 변경
          </EditNodeButton>
        ) : null}
      </div>
    </MediaNodeView>
  );
}

/**
 * 이미지·영상 노드의 공통 틀: 문서 보기와 같은 상자(`wiki-media`)에 그림과 캡션 칸, 그 아래에
 * `children`(노드마다 다른 줄)과 크기·정렬 고르기를 둔다.
 */
function MediaNodeView({
  node,
  selected,
  updateAttributes,
  editor,
  media,
  youtube = false,
  allowOriginal = false,
  children,
}: ReactNodeViewProps & {
  media: ReactNode;
  youtube?: boolean;
  allowOriginal?: boolean;
  children?: ReactNode;
}) {
  const wikiNode = asWikiNode(node);
  const size = mediaSize(wikiNode);
  const align = mediaAlign(wikiNode);
  const caption = String(node.attrs.caption ?? "");

  return (
    <NodeViewWrapper
      className={cn("wiki-image-edit", selected && "ring-1 ring-ring/60")}
      data-drag-handle=""
    >
      <div contentEditable={false}>
        <div
          className="wiki-media"
          data-size={size ?? undefined}
          data-align={align}
          data-youtube={youtube ? "" : undefined}
        >
          <div className="wiki-media-item">
            {media}
            {/* 문서 보기의 캡션과 같은 자리·모양(배경 띠)이다. 편집기에서는 비어 있어도 띠를 보여
                적을 자리를 알린다. `size={1}`: 입력칸의 기본 폭이 그림 칸을 넓히지 않게 한다. */}
            {editor.isEditable || caption !== "" ? (
              <AttrInput
                size={1}
                value={caption}
                placeholder="캡션 (선택)"
                aria-label="캡션"
                readOnly={!editor.isEditable}
                onCommit={(value) => updateAttributes({ caption: value })}
                className="wiki-media-caption w-full min-w-0 outline-none placeholder:text-muted-foreground/70"
              />
            ) : null}
          </div>
        </div>
        {children}
        {editor.isEditable ? (
          <MediaControls
            size={size}
            align={align}
            allowOriginal={allowOriginal}
            onChange={updateAttributes}
          />
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

/** 노드를 대화상자로 고치는 작은 단추(틀·영상). */
function EditNodeButton({
  className,
  onClick,
  children,
}: {
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground",
        className,
      )}
      onClick={onClick}
    >
      <Pencil className="size-3" aria-hidden />
      {children}
    </button>
  );
}

const ALIGN_ICON: Record<MediaAlign, ReactNode> = {
  left: <AlignLeft className="size-3.5" aria-hidden />,
  center: <AlignCenter className="size-3.5" aria-hidden />,
  right: <AlignRight className="size-3.5" aria-hidden />,
};

/** 이미지·영상의 크기와 정렬 고르기. `allowOriginal`이면 "원본" 크기(고르지 않음)도 있다. */
function MediaControls({
  size,
  align,
  allowOriginal = false,
  onChange,
}: {
  size: MediaSize | null;
  align: MediaAlign;
  allowOriginal?: boolean;
  onChange: (attrs: { size?: MediaSize | null; align?: MediaAlign }) => void;
}) {
  const sizes: (MediaSize | null)[] = allowOriginal
    ? [null, ...MEDIA_SIZES]
    : [...MEDIA_SIZES];
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <div role="group" aria-label="크기" className="flex gap-0.5">
        {sizes.map((option) => (
          <ChoiceButton
            key={option ?? "original"}
            active={option === size}
            onClick={() => onChange({ size: option })}
          >
            {option ? MEDIA_SIZE_LABEL[option] : "원본"}
          </ChoiceButton>
        ))}
      </div>
      <div role="group" aria-label="정렬" className="flex gap-0.5">
        {MEDIA_ALIGNS.map((option) => (
          <ChoiceButton
            key={option}
            active={option === align}
            label={`${MEDIA_ALIGN_LABEL[option]} 정렬`}
            onClick={() => onChange({ align: option })}
          >
            {ALIGN_ICON[option]}
          </ChoiceButton>
        ))}
      </div>
    </div>
  );
}

function ChoiceButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={active ? "secondary" : "ghost"}
      aria-pressed={active}
      aria-label={label}
      title={label}
      // 누르는 순간 편집기의 선택이 풀리지 않게 한다(툴바 단추와 같다).
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
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
