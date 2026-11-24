import type { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { useEditorState } from "@tiptap/react";
import { Baseline, PaintBucket } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import {
  backgroundVars,
  contrastRatio,
  formatCustomColor,
  HUE_LABEL,
  HUES,
  MARK,
  MIN_CONTRAST,
  NODE,
  normalizeHex,
  PAGE_BACKGROUND,
  paletteBackground,
  parseBackground,
  parseTextColor,
  textColorVars,
} from "~/features/markup";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

type ColorKind = "text" | "background";

/**
 * 색 고르기. 팔레트가 먼저다. 팔레트 색은 두 화면 모드에서 대비를 맞춰 두었다.
 *
 * `#rrggbb` 직접 입력은 접어 둔 "직접 입력" 안에만 둔다. 어두운 화면에서 읽히지 않는 색을 고를 수
 * 있으므로 먼저 권하지 않는다. 대비가 모자라면 그 자리에서 알린다.
 */
export function ColorPicker({
  kind,
  value,
  onChange,
}: {
  kind: ColorKind;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const rows: { label?: string; strong: boolean }[] =
    kind === "text"
      ? [{ strong: false }]
      : [
          { label: "연하게", strong: false },
          { label: "진하게", strong: true },
        ];

  return (
    <div className="grid gap-2">
      {rows.map(({ label, strong }) => (
        <div key={String(strong)} className="grid gap-1">
          {label ? (
            <p className="text-xs text-muted-foreground">{label}</p>
          ) : null}
          <div
            role="group"
            aria-label={label ?? "팔레트"}
            className="grid grid-cols-9 gap-1"
          >
            {HUES.map((hue) => {
              const option =
                kind === "text" ? hue : paletteBackground(hue, strong);
              return (
                <Swatch
                  key={hue}
                  kind={kind}
                  value={option}
                  label={`${HUE_LABEL[hue]}${strong ? " (진하게)" : ""}`}
                  active={value === option}
                  onClick={() => onChange(option)}
                />
              );
            })}
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={value === null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onChange(null)}
      >
        {kind === "text" ? "기본 색" : "배경 없음"}
      </Button>
      <CustomColorInput kind={kind} value={value} onApply={onChange} />
    </div>
  );
}

function Swatch({
  kind,
  value,
  label,
  active,
  onClick,
}: {
  kind: ColorKind;
  value: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const color = kind === "text" ? parseTextColor(value) : null;
  const background = kind === "background" ? parseBackground(value) : null;
  const style = color
    ? textColorVars(color)
    : background
      ? backgroundVars(background).vars
      : undefined;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
            className={cn(
              "flex aspect-square w-full min-w-6 items-center justify-center rounded-md border text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
              kind === "text"
                ? "[color:var(--wiki-fg)] dark:[color:var(--wiki-fg-dark)]"
                : "[background-color:var(--wiki-bg)] [color:var(--wiki-on)] dark:[background-color:var(--wiki-bg-dark)] dark:[color:var(--wiki-on-dark)]",
              active && "ring-2 ring-ring ring-offset-1 ring-offset-popover",
            )}
            style={style}
          />
        }
      >
        가
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** 접어 둔 `#rrggbb` 입력. 어두운 화면 색은 넣지 않으면 밝은 화면 색을 그대로 쓴다. */
function CustomColorInput({
  kind,
  value,
  onApply,
}: {
  kind: ColorKind;
  value: string | null;
  onApply: (value: string) => void;
}) {
  const current =
    kind === "text" ? parseTextColor(value) : parseBackground(value);
  const custom = current?.kind === "custom" ? current : null;
  const [light, setLight] = useState(custom?.light ?? "");
  const [dark, setDark] = useState(custom?.dark ?? "");
  const id = useId();

  const lightHex = normalizeHex(light);
  const darkHex = dark.trim() ? normalizeHex(dark) : null;
  const valid = lightHex !== null && (dark.trim() === "" || darkHex !== null);

  // 글자 색은 본문 바탕과의 대비를 알린다. 배경은 그 위의 글자 색을 자동으로 고르므로 알리지 않는다.
  const warnings: string[] = [];
  if (kind === "text" && lightHex) {
    const lightRatio = contrastRatio(lightHex, PAGE_BACKGROUND.light);
    const darkRatio = contrastRatio(darkHex ?? lightHex, PAGE_BACKGROUND.dark);
    if (lightRatio < MIN_CONTRAST) {
      warnings.push(
        `밝은 화면에서 읽기 어렵습니다(대비 ${lightRatio.toFixed(1)}:1).`,
      );
    }
    if (darkRatio < MIN_CONTRAST) {
      warnings.push(
        `어두운 화면에서 읽기 어렵습니다(대비 ${darkRatio.toFixed(1)}:1).`,
      );
    }
  }

  return (
    <details className="text-xs text-muted-foreground" open={custom !== null}>
      <summary className="cursor-pointer select-none">직접 입력</summary>
      <div className="mt-2 grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor={`${id}-light`} className="text-xs">
              밝은 화면
            </Label>
            <Input
              id={`${id}-light`}
              value={light}
              placeholder="#336699"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={light.trim() !== "" && lightHex === null}
              onChange={(event) => setLight(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-dark`} className="text-xs">
              어두운 화면(선택)
            </Label>
            <Input
              id={`${id}-dark`}
              value={dark}
              placeholder={lightHex ?? "#99bbdd"}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={dark.trim() !== "" && darkHex === null}
              onChange={(event) => setDark(event.target.value)}
            />
          </div>
        </div>
        {warnings.map((warning) => (
          <p key={warning} className="text-destructive">
            {warning}
          </p>
        ))}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!valid}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            lightHex &&
            onApply(formatCustomColor({ light: lightHex, dark: darkHex }))
          }
        >
          적용
        </Button>
      </div>
    </details>
  );
}

/** 툴바의 팝오버 단추. 팝오버는 편집기를 가리지 않아 고르는 대로 결과가 보인다. */
function PopoverToolButton({
  label,
  icon,
  active,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant={active ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label={label}
                  // 누르는 순간 편집기의 선택이 풀리지 않게 한다.
                  onMouseDown={(event) => event.preventDefault()}
                />
              }
            />
          }
        >
          {icon}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** 글자 색 단추. 고르면 닫고 편집기로 돌아간다. */
export function TextColorButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const color = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const value: unknown = current.getAttributes(MARK.textColor).color;
      return typeof value === "string" ? value : null;
    },
  });

  return (
    <PopoverToolButton
      label="글자 색"
      icon={<Baseline />}
      active={color !== null}
      open={open}
      onOpenChange={setOpen}
    >
      <ColorPicker
        kind="text"
        value={color}
        onChange={(next) => {
          const chain = editor.chain().focus();
          if (next) chain.setMark(MARK.textColor, { color: next }).run();
          else chain.unsetMark(MARK.textColor).run();
          setOpen(false);
        }}
      />
    </PopoverToolButton>
  );
}

/**
 * 셀 배경 단추(표 안에 있을 때만 보인다). 고른 셀 전부에 건다. 칸 안 글의 정렬은 문단 정렬로 한다.
 * 팝오버를 연 채로 여러 칸을 바꿔 볼 수 있게 고를 때 닫지 않는다.
 */
export function CellStyleButton({ editor }: { editor: Editor }) {
  return (
    <BackgroundButton
      editor={editor}
      label="셀 배경"
      read={(current) => activeCellAttrs(current).background}
      write={(next) => setCellAttr(editor, "background", next)}
    />
  );
}

/**
 * 이미지·영상 캡션의 띠 배경 단추(커서가 캡션 안에 있을 때만 보인다). 표 칸 배경과 같은 팔레트다.
 */
export function CaptionStyleButton({ editor }: { editor: Editor }) {
  return (
    <BackgroundButton
      editor={editor}
      label="캡션 배경"
      read={(current) => current.getAttributes(NODE.caption).background}
      write={(next) =>
        editor.commands.updateAttributes(NODE.caption, { background: next })
      }
    />
  );
}

/** 배경 고르기 단추(셀·캡션). `read`는 지금 값을 읽고, `write`는 고른 값(지우면 `null`)을 건다. */
function BackgroundButton({
  editor,
  label,
  read,
  write,
}: {
  editor: Editor;
  label: string;
  read: (editor: Editor) => unknown;
  write: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const background = useEditorState({
    editor,
    selector: ({ editor: current }): string | null => {
      const value = read(current);
      return typeof value === "string" ? value : null;
    },
  });

  return (
    <PopoverToolButton
      label={label}
      icon={<PaintBucket />}
      active={background !== null}
      open={open}
      onOpenChange={setOpen}
    >
      <ColorPicker kind="background" value={background} onChange={write} />
    </PopoverToolButton>
  );
}

/** 커서가 있는 칸(제목 칸이나 보통 칸)의 속성. */
export function activeCellAttrs(editor: Editor): Record<string, unknown> {
  return editor.getAttributes(
    editor.isActive(NODE.tableHeader) ? NODE.tableHeader : NODE.tableCell,
  );
}

/**
 * 셀 속성을 고른 칸 전부에 건다. 칸을 여러 개 고르지 않았으면 커서가 있는 칸에 건다. 팝오버나 메뉴가
 * 초점을 가져가도 편집기의 선택(고른 칸)은 남으므로 초점을 편집기로 되돌리지 않는다.
 */
export function setCellAttr(
  editor: Editor,
  name: string,
  value: string | null,
): boolean {
  return editor.commands.command(({ commands, tr }) => {
    const { selection } = tr;
    if (!(selection instanceof CellSelection)) {
      return commands.setCellAttribute(name, value);
    }
    selection.forEachCell((cell, pos) => {
      if (cell.attrs[name] !== value) {
        tr.setNodeMarkup(pos, undefined, { ...cell.attrs, [name]: value });
      }
    });
    return true;
  });
}
