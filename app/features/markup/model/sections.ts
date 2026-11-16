import { splitFencedCode } from "./code-regions";

/**
 * 문단 편집용 경계 계산.
 *
 * 원문에서 `#`로 시작하는 제목 줄만 본다(밑줄로 만드는 제목은 세지 않는다). 문단은 제목 줄부터,
 * 같거나 더 높은 단계의 다음 제목 앞까지다. 하위 문단은 상위 문단에 포함된다.
 */
export interface Section {
  /** 문서 안에서 몇 번째 제목인지(0부터). 렌더러의 `HeadingInfo.index`와 같은 번호다. */
  index: number;
  depth: number;
  title: string;
  /** 원문에서의 글자 위치. `[start, end)`. */
  start: number;
  end: number;
}

const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

export function findSections(source: string): Section[] {
  const headings: Omit<Section, "end">[] = [];
  let offset = 0;

  for (const region of splitFencedCode(source)) {
    if (!region.code) {
      let lineStart = offset;
      for (const line of region.text.split("\n")) {
        const match = ATX_HEADING.exec(line);
        if (match) {
          headings.push({
            index: headings.length,
            depth: match[1]!.length,
            title: match[2]!.trim(),
            start: lineStart,
          });
        }
        lineStart += line.length + 1;
      }
    }
    offset += region.text.length + 1;
  }

  return headings.map((heading, position) => {
    const next = headings
      .slice(position + 1)
      .find((later) => later.depth <= heading.depth);
    return { ...heading, end: next ? next.start : source.length };
  });
}

/** 문단의 원문. 없는 번호면 `null`. */
export function getSection(source: string, index: number): string | null {
  const section = findSections(source)[index];
  return section ? source.slice(section.start, section.end) : null;
}

/**
 * 문단 하나를 새 글로 바꾼 전체 본문. 없는 번호면 `null`.
 *
 * 뒤 문단과 붙지 않도록 문단 끝의 줄바꿈을 맞춘다.
 */
export function replaceSection(
  source: string,
  index: number,
  replacement: string,
): string | null {
  const section = findSections(source)[index];
  if (!section) return null;

  const before = source.slice(0, section.start);
  const after = source.slice(section.end);
  const body = replacement.replace(/\s+$/, "");
  const separator = after === "" ? "\n" : "\n\n";
  return `${before}${body}${body === "" ? "" : separator}${after}`;
}
