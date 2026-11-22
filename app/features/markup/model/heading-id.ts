/**
 * 문단 제목에서 `#` 뒤에 붙는 id를 만든다.
 *
 * 본문 제목(`## 신청 방법`)과 링크(`[[귀가#신청 방법]]`)가 같은 함수를 써야 서로 맞는다.
 */
export function headingId(text: string): string {
  return text
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_.·]/gu, "");
}

/** 문서 링크 뒤에 붙는 문단 주소(`#신청-방법`). 문단이 없으면 빈 문자열. */
export function sectionAnchor(section: string): string {
  return section.trim() ? `#${encodeURI(headingId(section))}` : "";
}

/** 같은 이름의 문단이 여럿이면 둘째부터 `-2`, `-3`을 붙인다. */
export function createHeadingIdAllocator(): (text: string) => string {
  const used = new Map<string, number>();
  return (text) => {
    const base = headingId(text) || "문단";
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };
}
