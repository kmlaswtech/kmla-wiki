import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Baseline, PaintBucket } from "lucide-react";
import { useId, useState, type CSSProperties, type ReactNode } from "react";

import {
  backgroundVars,
  formatCustomColor,
  HUE_LABEL,
  HUES,
  MARK,
  NODE,
  normalizeHex,
  paletteBackground,
  parseBackground,
  parseTextColor,
  textColorVars,
  type CellBackground,
  type Hue,
} from "~/features/markup";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "~/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

import { activeCellAttr, MIXED, setCellAttr } from "../model/cell-attrs";
import {
  backgroundsBehind,
  CAPTION_NODES,
  CELL_NODES,
  paletteHuesIn,
} from "../model/color-context";
import { contrastNotice, customTextWarnings } from "../model/contrast-notice";

type ColorKind = "text" | "background";

/**
 * 색 고르기. 팔레트가 먼저다. 팔레트 색은 두 화면 모드에서 대비를 맞춰 두었다.
 *
 * `#rrggbb` 직접 입력은 접어 둔 "직접 입력" 안에만 둔다. 어두운 화면에서 읽히지 않는 색을 고를 수
 * 있으므로 먼저 권하지 않는다. 대비가 모자라면 그 자리에서 알린다.
 *
 * 셀·캡션 배경 위에서는 팔레트 글자 색을 대비에 맞게 보정해 그린다(`adjustForContrast`). 고르기 전에
 * 알 수 있게, 보정되는 칸은 보정한 색으로 그리고 점을 찍는다(`contrastNotice`). 지금 고른 색이
 * 보정되면 그 까닭을 아래에 적는다. 화면 읽기 프로그램에는 칸 이름에 같은 문구를 붙여 알린다.
 */
export function ColorPicker({
  kind,
  value,
  onChange,
  behind = [],
  textHues = [],
}: {
  kind: ColorKind;
  /** 지금 색. 없으면 `null`, 고른 칸들의 색이 섞였으면 `MIXED`(아무것도 눌려 보이지 않는다). */
  value: string | null | typeof MIXED;
  onChange: (value: string | null) => void;
  /** 글자 색: 뒤에 깔린 셀·캡션 배경들. `null`은 배경 없음이다. */
  behind?: readonly (CellBackground | null)[];
  /** 배경: 그 안에 쓴 팔레트 글자 색. */
  textHues?: readonly Hue[];
}) {
  const backgrounds = behind.filter((item) => item !== null);
  const noticeOf = (option: string) =>
    contrastNotice(kind, option, backgrounds, textHues);
  const activeNotice = typeof value === "string" ? noticeOf(value) : null;
  // 글자 색 칸은 뒤에 깔린 배경이 하나일 때만 그 위에 그린다. 그 배경의 변수가 보정한 팔레트 색을 준다.
  const preview = behind.length === 1 ? (behind[0] ?? null) : null;
  const previewVars = preview ? backgroundVars(preview).vars : null;
  const swatchStyle = (option: string) => {
    const color = kind === "text" ? parseTextColor(option) : null;
    if (color) return { ...previewVars, ...textColorVars(color) };
    const background = parseBackground(option);
    return background ? backgroundVars(background).vars : undefined;
  };

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
              const name = `${HUE_LABEL[hue]}${strong ? " (진하게)" : ""}`;
              const notice = noticeOf(option);
              return (
                <Swatch
                  key={hue}
                  filled={kind === "background" || previewVars !== null}
                  textOnly={kind === "text"}
                  label={notice ? `${name}. ${notice.join(" ")}` : name}
                  marked={notice !== null}
                  active={value === option}
                  style={swatchStyle(option)}
                  onClick={() => onChange(option)}
                />
              );
            })}
          </div>
        </div>
      ))}
      {activeNotice ? (
        <div className="grid gap-0.5 text-xs text-muted-foreground">
          {activeNotice.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
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
      <CustomColorInput
        kind={kind}
        value={value === MIXED ? null : value}
        behind={behind}
        onApply={onChange}
      />
    </div>
  );
}

/**
 * 색 칸 하나. `filled`면 `--wiki-bg` 배경을 칠하고, `textOnly`면 글자를 `--wiki-fg`로, 아니면
 * `--wiki-on`으로 그린다. `marked`면 대비 보정 점을 찍는다.
 */
function Swatch({
  filled,
  textOnly,
  label,
  marked,
  active,
  style,
  onClick,
}: {
  filled: boolean;
  textOnly: boolean;
  label: string;
  marked: boolean;
  active: boolean;
  style: CSSProperties | undefined;
  onClick: () => void;
}) {
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
              "relative flex aspect-square w-full min-w-6 items-center justify-center rounded-md border text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filled &&
                "[background-color:var(--wiki-bg)] dark:[background-color:var(--wiki-bg-dark)]",
              textOnly
                ? "[color:var(--wiki-fg)] dark:[color:var(--wiki-fg-dark)]"
                : "[color:var(--wiki-on)] dark:[color:var(--wiki-on-dark)]",
              active && "ring-2 ring-ring ring-offset-1 ring-offset-popover",
            )}
            style={style}
          />
        }
      >
        가
        {marked ? (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-amber-500 ring-1 ring-white"
          />
        ) : null}
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{label}</TooltipContent>
    </Tooltip>
  );
}

/** 접어 둔 `#rrggbb` 입력. 어두운 화면 색은 넣지 않으면 밝은 화면 색을 그대로 쓴다. */
function CustomColorInput({
  kind,
  value,
  behind,
  onApply,
}: {
  kind: ColorKind;
  value: string | null;
  behind: readonly (CellBackground | null)[];
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

  // 글자 색은 뒤에 깔린 배경과의 대비를 알린다. 배경은 그 위의 글자 색을 자동으로 고르므로 알리지 않는다.
  const warnings =
    kind === "text" && lightHex
      ? customTextWarnings(lightHex, darkHex, behind)
      : [];

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
      <EditorColorPicker
        editor={editor}
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
 * 팝오버 안의 색 고르기. 팝오버가 열렸을 때만 붙으므로, 선택 맥락(글자 색은 뒤에 깔린 배경, 배경은 안의
 * 글자 색)을 읽는 일도 그때만 한다. 닫혀 있을 때 글자를 칠 때마다 읽지 않는다.
 */
function EditorColorPicker({
  editor,
  kind,
  types = [],
  value,
  onChange,
}: {
  editor: Editor;
  kind: ColorKind;
  /** 배경: 배경을 거는 노드. */
  types?: readonly string[];
  value: string | null | typeof MIXED;
  onChange: (value: string | null) => void;
}) {
  const context = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      kind === "text"
        ? { behind: backgroundsBehind(current), textHues: [] }
        : { behind: [], textHues: paletteHuesIn(current, types) },
  });
  return (
    <ColorPicker
      kind={kind}
      value={value}
      behind={context.behind.map(parseBackground)}
      textHues={context.textHues}
      onChange={onChange}
    />
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
      types={CELL_NODES}
      read={(current) => activeCellAttr(current, "background")}
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
      types={CAPTION_NODES}
      read={(current) => current.getAttributes(NODE.caption).background}
      write={(next) =>
        editor.commands.updateAttributes(NODE.caption, { background: next })
      }
    />
  );
}

/**
 * 배경 고르기 단추(셀·캡션). `read`는 지금 값을 읽고(섞였으면 `MIXED`), `write`는 고른 값(지우면
 * `null`)을 건다. `types`는 배경을 거는 노드다. 그 안의 글자 색이 보정되는지 미리 알린다.
 */
function BackgroundButton({
  editor,
  label,
  types,
  read,
  write,
}: {
  editor: Editor;
  label: string;
  types: readonly string[];
  read: (editor: Editor) => unknown;
  write: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const background = useEditorState({
    editor,
    selector: ({ editor: current }): string | null | typeof MIXED => {
      const value = read(current);
      return typeof value === "string" || value === MIXED ? value : null;
    },
  });

  return (
    <PopoverToolButton
      label={label}
      icon={<PaintBucket />}
      active={typeof background === "string"}
      open={open}
      onOpenChange={setOpen}
    >
      <EditorColorPicker
        editor={editor}
        kind="background"
        types={types}
        value={background}
        onChange={write}
      />
    </PopoverToolButton>
  );
}
