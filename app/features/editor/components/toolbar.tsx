import {
  Bold,
  CircleHelp,
  Ellipsis,
  Heading,
  Image,
  Link2,
  ListCollapse,
  Strikethrough,
  Superscript,
  Table,
  Underline,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  addFootnote,
  buildTable,
  insertBlock,
  toggleLinePrefix,
  wrapSelection,
} from "../model/commands";
import type { SourceEditorHandle } from "./source-editor";
import { pageHref } from "~/features/markup";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

interface ToolbarProps {
  editor: React.RefObject<SourceEditorHandle | null>;
  /** 이미지 버튼을 눌렀을 때. 주지 않으면 버튼을 그리지 않는다. */
  onPickImage?: () => void;
}

/**
 * 편집 툴바. 버튼 8개와 더보기.
 *
 * 기능 수를 일부러 묶어 둔다. 여기에 없는 꾸밈(글자 색·크기, 셀 병합, 정렬)은 지원하지 않는다.
 * 각 버튼이 하는 일은 `model/commands.ts`의 순수 함수이고, 여기는 그것을 편집기에 적용만 한다.
 */
export function Toolbar({ editor, onPickImage }: ToolbarProps) {
  const [tableOpen, setTableOpen] = useState(false);

  /** 현재 문서와 선택 범위로 명령을 계산해 적용한다. */
  const run = (
    command: (
      doc: string,
      selection: { from: number; to: number },
    ) => Parameters<SourceEditorHandle["apply"]>[0],
  ) => {
    const handle = editor.current;
    if (!handle) return;
    handle.apply(command(handle.getValue(), handle.getSelection()));
  };

  const wrap = (before: string, after: string, placeholder: string) =>
    run((doc, selection) =>
      wrapSelection(doc, selection, before, after, placeholder),
    );

  const block = (text: string, select?: string) =>
    run((doc, selection) => insertBlock(doc, selection, text, select));

  const heading = (prefix: string) =>
    run((doc, selection) => toggleLinePrefix(doc, selection, prefix, "제목"));

  const footnote = () => {
    const handle = editor.current;
    if (!handle) return;
    const next = addFootnote(
      handle.getValue(),
      handle.getSelection(),
      "각주 내용",
    );
    handle.replaceAll(next.doc, next.selection);
  };

  return (
    <div
      role="toolbar"
      aria-label="편집 도구"
      className="flex flex-wrap items-center gap-0.5 rounded-t-md border bg-muted/40 p-1"
    >
      <ToolButton label="굵게" onClick={() => wrap("**", "**", "굵은 글자")}>
        <Bold />
      </ToolButton>
      <ToolButton label="밑줄" onClick={() => wrap("__", "__", "밑줄 글자")}>
        <Underline />
      </ToolButton>
      <ToolButton label="취소선" onClick={() => wrap("~~", "~~", "지운 글자")}>
        <Strikethrough />
      </ToolButton>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="제목"
                  />
                }
              />
            }
          >
            <Heading />
          </TooltipTrigger>
          <TooltipContent>제목</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => heading("## ")}>
            큰 제목
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => heading("### ")}>
            중간 제목
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => heading("#### ")}>
            작은 제목
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ToolButton
        label="문서 링크"
        onClick={() => wrap("[[", "]]", "문서 이름")}
      >
        <Link2 />
      </ToolButton>
      {onPickImage ? (
        <ToolButton label="이미지" onClick={onPickImage}>
          <Image />
        </ToolButton>
      ) : null}
      <ToolButton label="각주" onClick={footnote}>
        <Superscript />
      </ToolButton>
      <ToolButton label="표" onClick={() => setTableOpen(true)}>
        <Table />
      </ToolButton>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="더보기"
                  />
                }
              />
            }
          >
            <Ellipsis />
          </TooltipTrigger>
          <TooltipContent>더보기</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() => block(":::접기 제목\n접을 내용\n:::", "제목")}
          >
            <ListCollapse />
            접기
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => wrap("{{틀:", "}}", "틀 이름")}>
            틀 넣기
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => block("[[분류:분류 이름]]", "분류 이름")}
          >
            분류
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => wrap("[", "](https://)", "보여 줄 글자")}
          >
            바깥 링크
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              const handle = editor.current;
              if (!handle) return;
              // 넘겨주기는 본문 맨 앞에 있어야 한다.
              handle.apply({
                change: { from: 0, to: 0, insert: "#넘겨주기 [[문서 이름]]\n" },
                selection: { from: 9, to: 14 },
              });
            }}
          >
            넘겨주기
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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

      <TableDialog
        open={tableOpen}
        onOpenChange={setTableOpen}
        onInsert={(rows, columns) => block(buildTable(rows, columns), "제목 1")}
      />
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
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

function clamp(value: string, min: number, max: number): number {
  const number = Number.parseInt(value, 10);
  return Number.isNaN(number) ? min : Math.min(Math.max(number, min), max);
}

function TableDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (rows: number, columns: number) => void;
}) {
  const [rows, setRows] = useState("2");
  const [columns, setColumns] = useState("3");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            // 대화상자는 화면에서는 따로 떠 있지만 React 트리에서는 편집 폼 안이다. 막지 않으면 이
            // 제출이 바깥 폼까지 올라가 문서가 저장된다.
            event.stopPropagation();
            onOpenChange(false);
            onInsert(clamp(rows, 1, 30), clamp(columns, 1, 10));
          }}
        >
          <DialogHeader>
            <DialogTitle>표 넣기</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="table-rows">줄</Label>
              <Input
                id="table-rows"
                type="number"
                min={1}
                max={30}
                value={rows}
                onChange={(event) => setRows(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="table-columns">칸</Label>
              <Input
                id="table-columns"
                type="number"
                min={1}
                max={10}
                value={columns}
                onChange={(event) => setColumns(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit">넣기</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
