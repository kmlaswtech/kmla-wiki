import { stringAttr, numberAttr, type WikiMark, type WikiNode } from "./doc";

/**
 * 글자·문단·표 꾸밈의 값. 편집기 스키마(`features/editor/model/schema.ts`)와 문서 보기(`WikiContent`)가
 * 같은 값을 읽고 같은 모양으로 그린다.
 *
 * 저장하는 것은 정해 둔 이름(팔레트 색, 크기 단계)이나 검사한 `#rrggbb`뿐이다. CSS 글자를 그대로
 * 저장하지 않는다. 그려 낼 때 이 값을 화면 모드별 CSS 변수로 바꾼다.
 */

/**
 * 팔레트 색. 글자 색은 흰 바탕(밝은 화면)과 `#18191a`(어두운 화면) 양쪽에서 대비 4.5:1 이상,
 * 진한 배경은 흰 글자와 4.5:1 이상이다.
 */
export const HUES = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;
export type Hue = (typeof HUES)[number];

const PALETTE = {
  gray: ["#606369", "#b5b7bc", "#eceff3", "#313336"],
  red: ["#b71824", "#ff9189", "#ffe6e3", "#492826"],
  orange: ["#a63d00", "#f5a06f", "#ffe8da", "#472b1b"],
  yellow: ["#875a00", "#d6b265", "#f9edd5", "#3f3112"],
  green: ["#107823", "#89cb8a", "#e1f5e0", "#223a23"],
  teal: ["#007671", "#75c9c3", "#d5f7f4", "#0a3b38"],
  blue: ["#0060c1", "#7ebaff", "#dff0ff", "#21344c"],
  purple: ["#7444b4", "#c4a4fd", "#f2eaff", "#372d49"],
  pink: ["#a42c71", "#f494c3", "#ffe5f2", "#462836"],
} satisfies Record<
  Hue,
  [lightText: string, darkText: string, lightFill: string, darkFill: string]
>;

export const HUE_LABEL: Record<Hue, string> = {
  gray: "회색",
  red: "빨강",
  orange: "주황",
  yellow: "노랑",
  green: "초록",
  teal: "청록",
  blue: "파랑",
  purple: "보라",
  pink: "분홍",
};

export function isHue(value: unknown): value is Hue {
  return (HUES as readonly unknown[]).includes(value);
}

const HEX = /^#[0-9a-f]{6}$/;

/** `#rgb`, `#rrggbb`(앞의 `#`는 없어도 된다)를 `#rrggbb` 소문자로 맞춘다. 아니면 `null`. */
export function normalizeHex(value: string): string | null {
  let hex = value.trim().toLowerCase();
  if (!hex.startsWith("#")) hex = `#${hex}`;
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    hex = `#${[...hex.slice(1)].map((digit) => digit + digit).join("")}`;
  }
  return HEX.test(hex) ? hex : null;
}

/** 직접 넣은 색. 어두운 화면 색을 넣지 않았으면 두 화면에 같은 색을 쓴다. */
export interface CustomColor {
  light: string;
  dark: string | null;
}

/** 직접 넣은 색을 저장할 값으로 만든다: `#rrggbb` 또는 `#밝은,#어두운`(나무위키와 같은 꼴). */
export function formatCustomColor({ light, dark }: CustomColor): string {
  return dark && dark !== light ? `${light},${dark}` : light;
}

function parseCustomColor(value: string): CustomColor | null {
  const [light = "", dark, ...rest] = value.split(",");
  if (rest.length > 0 || !HEX.test(light)) return null;
  if (dark === undefined) return { light, dark: null };
  return HEX.test(dark) ? { light, dark } : null;
}

export type TextColor =
  { kind: "palette"; hue: Hue } | ({ kind: "custom" } & CustomColor);

/** 글자 색 값(`red`, `#112233`, `#112233,#ddeeff`)을 읽는다. 모르는 값은 `null`. */
export function parseTextColor(value: unknown): TextColor | null {
  if (typeof value !== "string") return null;
  if (isHue(value)) return { kind: "palette", hue: value };
  const custom = parseCustomColor(value);
  return custom ? { kind: "custom", ...custom } : null;
}

export type CellBackground =
  | { kind: "palette"; hue: Hue; strong: boolean }
  | ({ kind: "custom" } & CustomColor);

/** 진한 배경 값의 꼴. 연한 배경은 색 이름만 쓴다(`red`), 진한 배경은 뒤에 붙인다(`red-strong`). */
const STRONG_SUFFIX = "-strong";

export function paletteBackground(hue: Hue, strong: boolean): string {
  return strong ? `${hue}${STRONG_SUFFIX}` : hue;
}

/** 셀 배경 값(`red`, `red-strong`, `#112233`, `#112233,#223344`)을 읽는다. 모르는 값은 `null`. */
export function parseBackground(value: unknown): CellBackground | null {
  if (typeof value !== "string") return null;
  if (isHue(value)) return { kind: "palette", hue: value, strong: false };
  if (value.endsWith(STRONG_SUFFIX)) {
    const hue = value.slice(0, -STRONG_SUFFIX.length);
    return isHue(hue) ? { kind: "palette", hue, strong: true } : null;
  }
  const custom = parseCustomColor(value);
  return custom ? { kind: "custom", ...custom } : null;
}

function channel(hex: string, index: number): number {
  const value = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return (
    0.2126 * channel(hex, 0) +
    0.7152 * channel(hex, 1) +
    0.0722 * channel(hex, 2)
  );
}

/** 두 `#rrggbb` 색의 대비(WCAG, 1~21). */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** 본문 글자로 기대하는 대비. */
export const MIN_CONTRAST = 4.5;

const ON_LIGHT = "#1f2023";
const ON_DARK = "#ffffff";

/** 이 배경 위에서 기준 대비를 충족하는 글자 색. */
export function readableOn(background: string): string {
  const light = contrastRatio(background, ON_LIGHT);
  const dark = contrastRatio(background, ON_DARK);
  if (Math.max(light, dark) < MIN_CONTRAST) return "#000000";
  return light >= dark ? ON_LIGHT : ON_DARK;
}

/** 각 화면 모드의 본문 바탕. 직접 넣은 글자 색의 대비를 알릴 때 쓴다(`app.css`의 `--background`). */
export const PAGE_BACKGROUND = { light: "#ffffff", dark: "#18191a" } as const;

/** CSS 변수 묶음. React `style`이나 편집기 HTML의 `style` 글자로 쓴다. */
export type StyleVars = Record<`--${string}`, string>;

/**
 * 팔레트 글자 색은 셀 배경과 대비를 검사한 값을 우선 쓴다. 셀 밖에서는 팔레트 원래 색을 쓴다.
 */
export function textColorVars(color: TextColor): StyleVars {
  if (color.kind === "palette") {
    const [light, dark] = PALETTE[color.hue];
    return {
      "--wiki-fg": `var(--wiki-cell-text-${color.hue}, ${light})`,
      "--wiki-fg-dark": `var(--wiki-cell-text-${color.hue}-dark, ${dark})`,
    };
  }
  return {
    "--wiki-fg": color.light,
    "--wiki-fg-dark": color.dark ?? color.light,
  };
}

/**
 * 셀 배경을 CSS 변수로 바꾼다. 진한 배경과 직접 넣은 색은 그 위의 글자 색도 함께 정한다(`strong`).
 * 그런 셀 안의 링크는 링크 색 대신 글자 색에 밑줄로 그린다(배경 위에서 파랑이 읽히지 않을 수 있다).
 */
export function backgroundVars(background: CellBackground): {
  vars: StyleVars;
  strong: boolean;
} {
  const strong = background.kind === "custom" || background.strong;
  const [light, dark] = backgroundColors(background);
  const onLight = strong ? readableOn(light) : "var(--foreground)";
  const onDark = strong ? readableOn(dark) : "var(--foreground)";
  const vars: StyleVars = {
    "--wiki-bg": light,
    "--wiki-on": onLight,
    "--wiki-bg-dark": dark,
    "--wiki-on-dark": onDark,
  };
  for (const hue of HUES) {
    const [lightText, darkText] = PALETTE[hue];
    vars[`--wiki-cell-text-${hue}`] =
      contrastRatio(lightText, light) >= MIN_CONTRAST ? lightText : onLight;
    vars[`--wiki-cell-text-${hue}-dark`] =
      contrastRatio(darkText, dark) >= MIN_CONTRAST ? darkText : onDark;
  }
  return { vars, strong };
}

function backgroundColors(background: CellBackground): [string, string] {
  if (background.kind === "custom") {
    return [background.light, background.dark ?? background.light];
  }
  const [strong, , light, dark] = PALETTE[background.hue];
  return background.strong ? [strong, strong] : [light, dark];
}

/** 편집기 HTML(`renderHTML`)에 쓰는 `style` 글자. 값은 위에서 검사한 것만 들어온다. */
export function styleText(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `${name}: ${value}`)
    .join("; ");
}

/** 글자 크기 단계. 0(보통)은 저장하지 않는다. 크기는 `app.css`의 `[data-text-size]`가 정한다. */
export const TEXT_SIZES = [-2, -1, 1, 2, 3] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const TEXT_SIZE_LABEL: Record<TextSize, string> = {
  [-2]: "아주 작게",
  [-1]: "작게",
  1: "크게",
  2: "더 크게",
  3: "아주 크게",
};

export function isTextSize(value: unknown): value is TextSize {
  return (TEXT_SIZES as readonly unknown[]).includes(value);
}

/** 문단 정렬. 왼쪽(기본)은 저장하지 않는다. */
export const TEXT_ALIGNS = ["center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export function isTextAlign(value: unknown): value is TextAlign {
  return (TEXT_ALIGNS as readonly unknown[]).includes(value);
}

/**
 * 문단·제목의 정렬. 모르는 값은 `null`(왼쪽). 표 칸에는 따로 가로 정렬을 두지 않는다. 칸 안의 글도
 * 문단이므로 문단 정렬로 맞춘다.
 */
export function textAlignOf(node: WikiNode): TextAlign | null {
  const value = stringAttr(node, "textAlign");
  return isTextAlign(value) ? value : null;
}

/** 표 칸의 세로 정렬. 위(기본)는 저장하지 않는다. 값은 CSS `vertical-align` 값과 같다. */
export const CELL_VALIGNS = ["middle", "bottom"] as const;
export type CellVAlign = (typeof CELL_VALIGNS)[number];

export function isCellVAlign(value: unknown): value is CellVAlign {
  return (CELL_VALIGNS as readonly unknown[]).includes(value);
}

/** 표 칸의 세로 정렬. 모르는 값은 `null`(위). */
export function cellVAlignOf(cell: WikiNode): CellVAlign | null {
  const value = stringAttr(cell, "verticalAlign");
  return isCellVAlign(value) ? value : null;
}

export function textSizeOf(mark: WikiMark): TextSize | null {
  const value = numberAttr(mark, "size");
  return isTextSize(value) ? value : null;
}
