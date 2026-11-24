import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  CircleHelp,
  Code,
  CornerDownRight,
  Ellipsis,
  Heading,
  IdCard,
  Image,
  Link2,
  List,
  ListCollapse,
  ListOrdered,
  Minus,
  Puzzle,
  Quote,
  Redo2,
  SquarePlay,
  Superscript,
  Table,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";

import { activeCellAttr, setCellAttr } from "../model/cell-attrs";
import type { EditorRequest } from "./editor-ui";
import { Divider, MarkTools, Menu, ToolButton } from "./mark-tools";
import { CaptionStyleButton, CellStyleButton } from "./style-controls";
import {
  isCellVAlign,
  isTextAlign,
  MARK,
  NODE,
  pageHref,
  type CellVAlign,
  type TextAlign,
} from "~/features/markup";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/shared/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

/** 정렬 메뉴의 항목. 첫 항목이 기본값(`null`)이다. 단추 아이콘과 메뉴 항목이 이 목록을 함께 쓴다. */
interface Choice<T extends string> {
  value: T | null;
  icon: ReactNode;
  label: string;
}

const TEXT_ALIGN_CHOICES: readonly Choice<TextAlign>[] = [
  { value: null, icon: <AlignLeft />, label: "왼쪽" },
  { value: "center", icon: <AlignCenter />, label: "가운데" },
  { value: "right", icon: <AlignRight />, label: "오른쪽" },
];

const CELL_VALIGN_CHOICES: readonly Choice<CellVAlign>[] = [
  { value: null, icon: <AlignVerticalJustifyStart />, label: "위" },
  { value: "middle", icon: <AlignVerticalJustifyCenter />, label: "가운데" },
  { value: "bottom", icon: <AlignVerticalJustifyEnd />, label: "아래" },
];

/** 지금 값의 아이콘. 맞는 항목이 없으면 기본값(첫 항목)의 아이콘이다. */
function choiceIcon<T extends string>(
  choices: readonly Choice<T>[],
  value: T | null,
): ReactNode {
  return (choices.find((choice) => choice.value === value) ?? choices[0]!).icon;
}

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
      link: current.isActive(MARK.link) || current.isActive(MARK.wikiLink),
      heading: ([2, 3, 4] as const).find((level) =>
        current.isActive(NODE.heading, { level }),
      ),
      bulletList: current.isActive(NODE.bulletList),
      orderedList: current.isActive(NODE.orderedList),
      blockquote: current.isActive(NODE.blockquote),
      inTable: current.isActive(NODE.table),
      inCaption: current.isActive(NODE.caption),
      cellVAlign: ((value: unknown) => (isCellVAlign(value) ? value : null))(
        activeCellAttr(current, "verticalAlign"),
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
  const alignIcon = choiceIcon(TEXT_ALIGN_CHOICES, state.textAlign);
  const setVAlign = (verticalAlign: CellVAlign | null) =>
    setCellAttr(editor, "verticalAlign", verticalAlign);
  const vAlignIcon = choiceIcon(CELL_VALIGN_CHOICES, state.cellVAlign);

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

      <MarkTools editor={editor} />

      {/* 캡션은 그림 아래 한 줄이라 문단 모양(제목, 목록, 인용, 정렬)을 바꿀 수 없다. */}
      <Menu
        label="제목"
        active={state.heading !== undefined}
        disabled={state.inCaption}
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
        disabled={state.inCaption}
        onClick={() => chain().toggleBulletList().run()}
      >
        <List />
      </ToolButton>
      <ToolButton
        label="번호 목록"
        active={state.orderedList}
        disabled={state.inCaption}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolButton>
      <ToolButton
        label="인용"
        active={state.blockquote}
        disabled={state.inCaption}
        onClick={() => chain().toggleBlockquote().run()}
      >
        <Quote />
      </ToolButton>
      <Menu
        label="문단 정렬"
        active={state.textAlign !== null}
        disabled={state.inCaption}
        icon={alignIcon}
      >
        {TEXT_ALIGN_CHOICES.map(({ value, icon, label }) => (
          <DropdownMenuItem key={label} onClick={() => setAlign(value)}>
            {icon}
            {label}
          </DropdownMenuItem>
        ))}
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
      {state.inCaption ? <CaptionStyleButton editor={editor} /> : null}
      {state.inTable ? (
        <Menu
          label="칸 세로 정렬"
          active={state.cellVAlign !== null}
          icon={vAlignIcon}
        >
          {CELL_VALIGN_CHOICES.map(({ value, icon, label }) => (
            <DropdownMenuItem key={label} onClick={() => setVAlign(value)}>
              {icon}
              {label}
            </DropdownMenuItem>
          ))}
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
              .leaveCaption()
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
        <DropdownMenuItem
          onClick={() => chain().leaveCaption().toggleCodeBlock().run()}
        >
          <Code />
          코드 블록
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => chain().leaveCaption().setHorizontalRule().run()}
        >
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
