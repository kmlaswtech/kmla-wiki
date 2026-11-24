import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  ALargeSmall,
  Bold,
  Italic,
  Strikethrough,
  Underline,
} from "lucide-react";
import type { ReactNode } from "react";

import { TextColorButton } from "./style-controls";
import {
  isTextSize,
  MARK,
  TEXT_SIZE_LABEL,
  TEXT_SIZES,
} from "~/features/markup";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

/**
 * 글자 꾸밈 단추 묶음(굵게, 기울임, 밑줄, 취소선, 색, 크기). 본문 툴바와 각주 편집기가 같이 쓴다.
 * 블록을 바꾸는 단추는 넣지 않는다. 각주 안에는 블록이 들어갈 수 없기 때문이다.
 */
export function MarkTools({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive(MARK.bold),
      italic: current.isActive(MARK.italic),
      underline: current.isActive(MARK.underline),
      strike: current.isActive(MARK.strike),
      textSize: ((value: unknown) => (isTextSize(value) ? value : null))(
        current.getAttributes(MARK.textSize).size,
      ),
    }),
  });
  const chain = () => editor.chain().focus();

  return (
    <>
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
    </>
  );
}

export function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

export function ToolButton({
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

export function Menu({
  label,
  icon,
  active = false,
  disabled = false,
  children,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
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
                  disabled={disabled}
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
