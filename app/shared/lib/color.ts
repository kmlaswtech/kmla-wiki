/**
 * `#rrggbb` 색 계산: WCAG 대비와, 대비를 맞추려고 명도만 옮기기(OKLab). 도메인을 모른다. 위키 팔레트와
 * 꾸밈 값은 `features/markup/model/style.ts`에 있다.
 */

function channel(hex: string, index: number): number {
  const value = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** 상대 휘도(WCAG, 0~1). */
export function luminance(hex: string): number {
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

/** 본문 글자로 기대하는 대비(WCAG AA). */
export const MIN_CONTRAST = 4.5;

function toOklab(hex: string): [number, number, number] {
  const r = channel(hex, 0);
  const g = channel(hex, 1);
  const b = channel(hex, 2);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(L: number, a: number, b: number): number[] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function linearToHex(rgb: number[]): string {
  return `#${rgb
    .map((value) => {
      const clamped = Math.min(1, Math.max(0, value));
      const srgb =
        clamped <= 0.0031308
          ? clamped * 12.92
          : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return Math.round(srgb * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

/** OKLab → `#rrggbb`. sRGB 밖이면 명도와 색조를 두고 채도만 줄인다. */
function fromOklab(L: number, a: number, b: number): string {
  const inGamut = (k: number) =>
    oklabToLinear(L, a * k, b * k).every(
      (value) => value >= -1e-4 && value <= 1 + 1e-4,
    );
  if (inGamut(1)) return linearToHex(oklabToLinear(L, a, b));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(mid)) lo = mid;
    else hi = mid;
  }
  return linearToHex(oklabToLinear(L, a * lo, b * lo));
}

/**
 * 글자 색을 이 배경 위에서 `MIN_CONTRAST`가 되게 맞춘다. 색조를 두고 명도만 옮긴다(OKLCH). 밝게·어둡게
 * 중 덜 옮기는 쪽을 쓴다. 이미 충분하면 그대로 돌려준다. 검정이나 흰색은 어떤 배경과도 4.5:1을 넘으므로
 * 언제나 답이 있다.
 */
export function adjustForContrast(text: string, background: string): string {
  if (contrastRatio(text, background) >= MIN_CONTRAST) return text;
  const [L, a, b] = toOklab(text);
  const at = (lightness: number) => fromOklab(lightness, a, b);
  const passes = (lightness: number) =>
    contrastRatio(at(lightness), background) >= MIN_CONTRAST;
  let best = { lightness: L, distance: Number.POSITIVE_INFINITY };
  for (const end of [0, 1]) {
    if (!passes(end)) continue;
    // L에서는 모자라고 end에서는 충분하다. 그 사이에서 기준을 넘는 가장 가까운 명도를 찾는다.
    let lo = L;
    let hi = end;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (passes(mid)) hi = mid;
      else lo = mid;
    }
    const distance = Math.abs(hi - L);
    if (distance < best.distance) best = { lightness: hi, distance };
  }
  return at(best.lightness);
}
