import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  ALargeSmall,
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  CircleHelp,
  Code,
  CornerDownRight,
  Ellipsis,
  Heading,
  IdCard,
  Image,
  Italic,
  Link2,
  List,
  ListCollapse,
  ListOrdered,
  Minus,
  Puzzle,
  Quote,
  Redo2,
  SquarePlay,
  Strikethrough,
  Superscript,
  Table,
  Underline,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";

import type { EditorRequest } from "./editor-ui";
import {
  activeCellAttrs,
  CellStyleButton,
  setCellAttr,
  TextColorButton,
} from "./style-controls";
import {
  isCellVAlign,
  isTextAlign,
  isTextSize,
  MARK,
  NODE,
  pageHref,
  TEXT_SIZE_LABEL,
  TEXT_SIZES,
  type CellVAlign,
  type TextAlign,
} from "~/features/markup";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

interface ToolbarProps {
  editor: Editor;
  request: (request: EditorRequest) => void;
  /** 이미지 버튼을 눌렀을 때. 주지 않으면 버튼을 그리지 않는다. */
  onPickImage?: () => void;
  /** 틀 문서를 고치는 중인가. 그러면 매개변수 넣기가 보인다. */
  isTemplatePage?: boolean;
  /** 이 문서를 넘겨주기로 바꾼다(넘겨주기 입력으로 간다). 주지 않으면 메뉴에 없다. */
  onConvertToRedirect?: () => void;
  /** 프로필(문서 맨 위의 따로 된 편집 칸)을 넣는다. 주지 않으면 메뉴에 없다(이미 있거나 문단 편집). */
  onAddProfile?: () => void;
  className?: string;
}

/**
 * 편집 툴바. 고른 글자에 바로 꾸밈이 들어간다(문법을 외울 필요가 없다).
 *
 * 자주 쓰는 꾸밈을 앞에 두고, 드물게 쓰는 것은 "더보기"에 둔다. 색은 팔레트에서 고른다
 * (`style-controls.tsx`).
 */
export function Toolbar({
  editor,
  request,
  onPickImage,
  isTemplatePage = false,
  onConvertToRedirect,
  onAddProfile,
  className,
}: ToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive(MARK.bold),
      italic: current.isActive(MARK.italic),
      underline: current.isActive(MARK.underline),
      strike: current.isActive(MARK.strike),
      link: current.isActive(MARK.link) || current.isActive(MARK.wikiLink),
      heading: ([2, 3, 4] as const).find((level) =>
        current.isActive(NODE.heading, { level }),
      ),
      bulletList: current.isActive(NODE.bulletList),
      orderedList: current.isActive(NODE.orderedList),
      blockquote: current.isActive(NODE.blockquote),
      inTable: current.isActive(NODE.table),
      cellVAlign: ((value: unknown) => (isCellVAlign(value) ? value : null))(
        activeCellAttrs(current).verticalAlign,
      ),
      textSize: ((value: unknown) => (isTextSize(value) ? value : null))(
        current.getAttributes(MARK.textSize).size,
      ),
      textAlign: ((value: unknown) => (isTextAlign(value) ? value : null))(
        current.isActive(NODE.heading)
          ? current.getAttributes(NODE.heading).textAlign
          : current.getAttributes(NODE.paragraph).textAlign,
      ),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();
  const setAlign = (textAlign: TextAlign | null) =>
    chain()
      .updateAttributes(NODE.paragraph, { textAlign })
      .updateAttributes(NODE.heading, { textAlign })
      .run();
  const AlignIcon =
    state.textAlign === "center"
      ? AlignCenter
      : state.textAlign === "right"
        ? AlignRight
        : AlignLeft;
  const setVAlign = (verticalAlign: CellVAlign | null) =>
    setCellAttr(editor, "verticalAlign", verticalAlign);
  const VAlignIcon =
    state.cellVAlign === "middle"
      ? AlignVerticalJustifyCenter
      : state.cellVAlign === "bottom"
        ? AlignVerticalJustifyEnd
        : AlignVerticalJustifyStart;

  return (
    <div
      role="toolbar"
      aria-label="편집 도구"
      className={cn(
        "flex flex-wrap items-center gap-0.5 rounded-t-md border bg-muted/90 p-1 backdrop-blur",
        // 폰에서는 한 줄로 두고 옆으로 민다. 두 줄로 접으면 키보드가 뜬 화면에서 글 쓸 자리를 더 먹는다.
        "max-sm:[scrollbar-width:none] max-sm:flex-nowrap max-sm:overflow-x-auto",
        className,
      )}
    >
      <ToolButton
        label="실행 취소"
        disabled={!state.canUndo}
        onClick={() => chain().undo().run()}
      >
        <Undo2 />
      </ToolButton>
      <ToolButton
        label="다시 실행"
        disabled={!state.canRedo}
        onClick={() => chain().redo().run()}
      >
        <Redo2 />
      </ToolButton>
      <Divider />

      <ToolButton
        label="굵게"
        active={state.bold}
        onClick={() => chain().toggleBold().run()}
      >
        <Bold />
      </ToolButton>
      <ToolButton
        label="기울임"
        active={state.italic}
        onClick={() => chain().toggleItalic().run()}
      >
        <Italic />
      </ToolButton>
      <ToolButton
        label="밑줄"
        active={state.underline}
        onClick={() => chain().toggleUnderline().run()}
      >
        <Underline />
      </ToolButton>
      <ToolButton
        label="취소선"
        active={state.strike}
        onClick={() => chain().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolButton>
      <TextColorButton editor={editor} />
      <Menu
        label="글자 크기"
        active={state.textSize !== null}
        icon={<ALargeSmall />}
      >
        <DropdownMenuItem
          onClick={() => chain().unsetMark(MARK.textSize).run()}
        >
          보통
        </DropdownMenuItem>
        {TEXT_SIZES.map((size) => (
          <DropdownMenuItem
            key={size}
            onClick={() => chain().setMark(MARK.textSize, { size }).run()}
          >
            <span
              className={cn(
                size === -2 && "text-xs",
                size === -1 && "text-sm",
                size === 1 && "text-base font-medium",
                size >= 2 && "text-lg font-semibold",
              )}
            >
              {TEXT_SIZE_LABEL[size]}
            </span>
          </DropdownMenuItem>
        ))}
      </Menu>

      <Menu
        label="제목"
        active={state.heading !== undefined}
        icon={<Heading />}
      >
        <DropdownMenuItem onClick={() => chain().setParagraph().run()}>
          본문
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => chain().toggleHeading({ level: 2 }).run()}
        >
          <span className="text-lg font-bold">큰 제목</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => chain().toggleHeading({ level: 3 }).run()}
        >
          <span className="font-bold">중간 제목</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => chain().toggleHeading({ level: 4 }).run()}
        >
          <span className="font-semibold">작은 제목</span>
        </DropdownMenuItem>
      </Menu>
      <Divider />

      <ToolButton
        label="글머리 기호 목록"
        active={state.bulletList}
        onClick={() => chain().toggleBulletList().run()}
      >
        <List />
      </ToolButton>
      <ToolButton
        label="번호 목록"
        active={state.orderedList}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolButton>
      <ToolButton
        label="인용"
        active={state.blockquote}
        onClick={() => chain().toggleBlockquote().run()}
      >
        <Quote />
      </ToolButton>
      <Menu
        label="문단 정렬"
        active={state.textAlign !== null}
        icon={<AlignIcon />}
      >
        <DropdownMenuItem onClick={() => setAlign(null)}>
          <AlignLeft />
          왼쪽
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setAlign("center")}>
          <AlignCenter />
          가운데
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setAlign("right")}>
          <AlignRight />
          오른쪽
        </DropdownMenuItem>
      </Menu>
      <Divider />

      <ToolButton
        label="링크"
        active={state.link}
        onClick={() => request({ kind: "link" })}
      >
        <Link2 />
      </ToolButton>
      {onPickImage ? (
        <ToolButton label="이미지" onClick={onPickImage}>
          <Image />
        </ToolButton>
      ) : null}
      <ToolButton
        label="유튜브 영상"
        onClick={() => request({ kind: "youtube" })}
      >
        <SquarePlay />
      </ToolButton>
      <ToolButton label="각주" onClick={() => request({ kind: "footnote" })}>
        <Superscript />
      </ToolButton>

      {state.inTable ? <CellStyleButton editor={editor} /> : null}
      {state.inTable ? (
        <Menu
          label="칸 세로 정렬"
          active={state.cellVAlign !== null}
          icon={<VAlignIcon />}
        >
          <DropdownMenuItem onClick={() => setVAlign(null)}>
            <AlignVerticalJustifyStart />위
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setVAlign("middle")}>
            <AlignVerticalJustifyCenter />
            가운데
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setVAlign("bottom")}>
            <AlignVerticalJustifyEnd />
            아래
          </DropdownMenuItem>
        </Menu>
      ) : null}
      {state.inTable ? (
        <Menu label="표" active icon={<Table />}>
          <DropdownMenuItem onClick={() => chain().addRowAfter().run()}>
            아래에 행 추가
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => chain().addColumnAfter().run()}>
            오른쪽에 열 추가
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => chain().deleteRow().run()}>
            행 삭제
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => chain().deleteColumn().run()}>
            열 삭제
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => chain().mergeOrSplit().run()}>
            셀 합치기·나누기
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => chain().toggleHeaderRow().run()}>
            머리글 행 전환
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => chain().deleteTable().run()}
          >
            표 삭제
          </DropdownMenuItem>
        </Menu>
      ) : (
        <ToolButton label="표" onClick={() => request({ kind: "table" })}>
          <Table />
        </ToolButton>
      )}

      <Menu label="더보기" icon={<Ellipsis />}>
        <DropdownMenuItem
          onClick={() =>
            chain()
              .insertContent({
                type: NODE.fold,
                attrs: { title: "" },
                content: [{ type: NODE.paragraph }],
              })
              .run()
          }
        >
          <ListCollapse />
          접기
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => request({ kind: "template" })}>
          <Puzzle />틀 삽입
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => chain().toggleCodeBlock().run()}>
          <Code />
          코드 블록
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => chain().setHorizontalRule().run()}>
          <Minus />
          구분선
        </DropdownMenuItem>
        {onAddProfile || onConvertToRedirect ? <DropdownMenuSeparator /> : null}
        {onAddProfile ? (
          <DropdownMenuItem onClick={onAddProfile}>
            <IdCard />
            프로필 넣기
          </DropdownMenuItem>
        ) : null}
        {onConvertToRedirect ? (
          <>
            <DropdownMenuItem onClick={onConvertToRedirect}>
              <CornerDownRight />
              넘겨주기로 바꾸기
            </DropdownMenuItem>
          </>
        ) : null}
        {isTemplatePage ? (
          <>
            <DropdownMenuSeparator />
            {[1, 2, 3].map((index) => (
              <DropdownMenuItem
                key={index}
                onClick={() =>
                  chain()
                    .insertContent({
                      type: NODE.templateParam,
                      attrs: { index },
                    })
                    .run()
                }
              >
                매개변수 {`{{{${index}}}}`}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </Menu>

      <span className="flex-1" />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              aria-label="편집 도움말 (새 탭)"
              render={
                <a
                  aria-label="편집 도움말 (새 탭)"
                  href={pageHref("위키:편집 도움말")}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            />
          }
        >
          <CircleHelp />
        </TooltipTrigger>
        <TooltipContent>편집 도움말</TooltipContent>
      </Tooltip>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

function ToolButton({
  label,
  onClick,
  active = false,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={active ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            // 누르는 순간 편집기의 선택이 풀리지 않게 한다.
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Menu({
  label,
  icon,
  active = false,
  children,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant={active ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label={label}
                />
              }
            />
          }
        >
          {icon}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {/* 메뉴 단추 너비가 아니라 항목 길이에 맞춘다("넘겨주기로 바꾸기"가 잘리지 않게). */}
      <DropdownMenuContent align="start" className="w-auto min-w-32">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
