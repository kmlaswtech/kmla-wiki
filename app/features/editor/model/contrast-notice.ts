import {
  backgroundColors,
  contrastRatio,
  HUE_LABEL,
  MIN_CONTRAST,
  PAGE_BACKGROUND,
  paletteTextShift,
  parseBackground,
  parseTextColor,
  type CellBackground,
  type ContrastShift,
  type Hue,
} from "~/features/markup";

/**
 * 셀·캡션 배경 위에서 팔레트 글자 색을 보정한다는 알림. 색 고르기 창이 보정되는 칸에 점을 찍고 이 문구를
 * 보인다. 표시는 지금 화면 모드와 관계없이 한다. 작성자가 보지 않는 화면 모드에서만 보정되는 경우를
 * 알리려는 것이기 때문이다.
 */

/** 화면 모드별 보정을 한 문장으로. 보정이 없으면 `null`. */
export function shiftMessage(shift: {
  light: ContrastShift;
  dark: ContrastShift;
}): string | null {
  if (shift.light && shift.dark) return "대비가 모자라 색 보정을 합니다.";
  const one = shift.light ?? shift.dark;
  if (!one) return null;
  const mode = shift.light ? "밝은" : "어두운";
  const way = one === "lighter" ? "밝게" : "어둡게";
  return `${mode} 화면에서 대비가 모자라 조금 ${way} 보입니다.`;
}

/**
 * 이 값을 고르면 보정이 생기는지. 글자 색(`kind: "text"`)은 뒤에 깔린 배경들(`behind`, 칸을 여러 개
 * 골랐으면 여럿)과, 배경은 그 안의 팔레트 글자 색(`textHues`)과 견준다. 보정이 없으면 `null`.
 */
export function contrastNotice(
  kind: "text" | "background",
  option: string,
  behind: readonly CellBackground[],
  textHues: readonly Hue[],
): string[] | null {
  const lines = new Set<string>();
  if (kind === "text") {
    const color = parseTextColor(option);
    if (color?.kind === "palette") {
      for (const background of behind) {
        const message = shiftMessage(paletteTextShift(color.hue, background));
        if (message) lines.add(message);
      }
    }
  } else {
    const background = parseBackground(option);
    if (background) {
      for (const hue of textHues) {
        const message = shiftMessage(paletteTextShift(hue, background));
        if (message) lines.add(`${HUE_LABEL[hue]} 글자: ${message}`);
      }
    }
  }
  return lines.size > 0 ? [...lines] : null;
}

/**
 * 직접 넣은 글자 색의 경고. 직접 넣은 색은 보정하지 않으므로 대비가 모자라면 알린다. 뒤에 깔린 배경들
 * (`null`은 배경 없음, 곧 본문 바탕) 가운데 가장 나쁜 대비로 판단한다.
 */
export function customTextWarnings(
  light: string,
  dark: string | null,
  behind: readonly (CellBackground | null)[],
): string[] {
  const page: [string, string] = [PAGE_BACKGROUND.light, PAGE_BACKGROUND.dark];
  const backs = (behind.length > 0 ? behind : [null]).map((background) =>
    background ? backgroundColors(background) : page,
  );
  const modes = [
    { name: "밝은", text: light, index: 0 },
    { name: "어두운", text: dark ?? light, index: 1 },
  ] as const;
  return modes.flatMap(({ name, text, index }) => {
    const ratio = Math.min(
      ...backs.map((colors) => contrastRatio(text, colors[index])),
    );
    return ratio < MIN_CONTRAST
      ? [`${name} 화면에서 읽기 어렵습니다(대비 ${ratio.toFixed(1)}:1).`]
      : [];
  });
}
