import { headingId } from "~/features/markup";
import type { HeadingTarget } from "~/features/pages";

/** 자동완성에 보일 문단 후보. `value`를 `#` 뒤에 넣는다. */
export interface SectionCandidate {
  label: string;
  value: string;
}

/**
 * 치는 중인 `#` 뒤 글자에 맞는 문단 후보. 비었으면 모든 문단이다.
 *
 * 링크는 `#` 뒤 글자를 `headingId`로 바꾸어 찾는다. 그래서 보통은 제목 글자를 그대로 넣는다. 같은 이름의
 * 둘째 문단부터는 id에 `-2`가 붙으므로 그 id를 넣는다.
 */
export function sectionCandidates(
  headings: readonly HeadingTarget[],
  query: string,
): SectionCandidate[] {
  const needle = query.trim().toLowerCase();
  const needleId = headingId(query).toLowerCase();
  const seen = new Set<string>();
  const result: SectionCandidate[] = [];
  for (const { text, id } of headings) {
    const value = headingId(text) === id ? text : id;
    if (seen.has(value)) continue;
    const matches =
      needle === "" ||
      text.toLowerCase().includes(needle) ||
      (needleId !== "" && id.toLowerCase().includes(needleId));
    if (!matches) continue;
    seen.add(value);
    result.push({ label: text === value ? text : `${text} (${value})`, value });
  }
  return result;
}

/** `#` 뒤 글자가 그 문서의 문단을 가리키는가. */
export function sectionExists(
  headings: readonly HeadingTarget[],
  section: string,
): boolean {
  const id = headingId(section);
  return headings.some((heading) => heading.id === id);
}
