import type { HeadingInfo } from "./plugins";

/** 목차를 그리는 최소 제목 수. 이보다 적으면 목차도, 본문 제목 번호도 붙이지 않는다. */
export const MIN_TOC_HEADINGS = 3;

export interface NumberedHeading extends HeadingInfo {
  /** 목차에서의 단계(1부터). 건너뛴 단계(## 다음 ####)도 한 단계로 센다. */
  level: number;
  /** `1`, `1.2`처럼 점으로 이은 번호. 끝의 점은 붙이지 않는다. */
  number: string;
}

/**
 * `1.`, `1.1.`처럼 단계별 번호를 매긴다. 목차와 본문 제목이 같은 번호를 쓴다.
 * 건너뛴 단계(## 다음 ####)도 한 단계로 센다.
 */
export function numberHeadings(
  headings: readonly HeadingInfo[],
): NumberedHeading[] {
  const counters: number[] = [];
  const depths: number[] = [];

  return headings.map((heading) => {
    while (depths.length > 0 && depths[depths.length - 1]! >= heading.depth) {
      depths.pop();
      counters.length = depths.length + 1;
    }
    if (counters.length <= depths.length) counters.push(0);
    counters[depths.length] = (counters[depths.length] ?? 0) + 1;
    depths.push(heading.depth);
    return {
      ...heading,
      level: depths.length,
      number: counters.slice(0, depths.length).join("."),
    };
  });
}

/** 제목 번호(`data-heading-index`)별 번호 문자열. 목차를 그리지 않는 문서면 `null`. */
export function headingNumberMap(
  headings: readonly HeadingInfo[],
): ReadonlyMap<number, string> | null {
  if (headings.length < MIN_TOC_HEADINGS) return null;
  return new Map(
    numberHeadings(headings).map((heading) => [heading.index, heading.number]),
  );
}
