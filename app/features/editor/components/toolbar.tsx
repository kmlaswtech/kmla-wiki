import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  CircleHelp,
  Code,
  Ellipsis,
  Heading,
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
  Strikethrough,
  Superscript,
  Table,
  Underline,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";

import type { EditorRequest } from "./editor-ui";
import { MARK, NODE, pageHref } from "~/features/markup";
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
  /** 틀 문서를 고치는 중인가. 그러면 값 자리 넣기가 보인다. */
  isTemplatePage?: boolean;
  /** 넘겨주기 칸을 연다. */
  onRedirect?: () => void;
  className?: string;
}

/**
 * 편집 툴바. 고른 글자에 바로 꾸밈이 들어간다(문법을 외울 필요가 없다).
 *
 * 기능 수를 일부러 묶어 둔다. 여기에 없는 꾸밈(글자 색·크기, 정렬)은 지원하지 않는다.
 */
export function Toolbar({
  editor,
  request,
  onPickImage,
  isTemplatePage = false,
  onRedirect,
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
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();

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
        label="글머리 목록"
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
      <ToolButton label="각주" onClick={() => request({ kind: "footnote" })}>
        <Superscript />
      </ToolButton>

      {state.inTable ? (
        <Menu label="표" active icon={<Table />}>
          <DropdownMenuItem onClick={() => chain().addRowAfter().run()}>
            아래에 줄 더하기
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => chain().addColumnAfter().run()}>
            오른쪽에 칸 더하기
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => chain().deleteRow().run()}>
            이 줄 지우기
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => chain().deleteColumn().run()}>
            이 칸 지우기
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => chain().mergeOrSplit().run()}>
            칸 합치기·나누기
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => chain().toggleHeaderRow().run()}>
            제목 줄 켜고 끄기
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => chain().deleteTable().run()}
          >
            표 지우기
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
          <Puzzle />틀 넣기
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => chain().toggleCodeBlock().run()}>
          <Code />
          코드 블록
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => chain().setHorizontalRule().run()}>
          <Minus />
          구분선
        </DropdownMenuItem>
        {onRedirect ? (
          <DropdownMenuItem onClick={onRedirect}>넘겨주기</DropdownMenuItem>
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
                값 자리 {`{{{${index}}}}`}
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
      <DropdownMenuContent align="start">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
