import {
  HEADING_LEVELS,
  NODE,
  nodeText,
  numberAttr,
  type WikiDoc,
  type WikiNode,
} from "./doc";

/**
 * 문단 편집용 경계 계산.
 *
 * 문서 맨 바깥의 제목만 문단을 나눈다(인용·접기·표 안의 제목은 세지 않는다). 문단은 제목부터, 같거나
 * 더 높은 단계의 다음 제목 앞까지다. 하위 문단은 상위 문단에 포함된다.
 */
export interface Section {
  /** 문서 안에서 몇 번째 제목인지(0부터). 렌더러의 `HeadingInfo.sectionIndex`와 같은 번호다. */
  index: number;
  depth: number;
  title: string;
  /** 맨 바깥 블록 목록에서의 범위. `[start, end)`. */
  start: number;
  end: number;
}

/** 제목 단계. 저장된 값이 범위 밖이면(조작된 본문 등) 가장 가까운 단계로 맞춘다. */
export function headingDepth(node: WikiNode): number {
  const level = Math.trunc(numberAttr(node, "level") ?? MIN_LEVEL);
  return Math.min(Math.max(level, MIN_LEVEL), MAX_LEVEL);
}

const MIN_LEVEL = HEADING_LEVELS[0];
const MAX_LEVEL = HEADING_LEVELS[HEADING_LEVELS.length - 1]!;

export function findSections(doc: WikiDoc): Section[] {
  const blocks = doc.content;
  const headings: Omit<Section, "end">[] = [];
  blocks.forEach((block, position) => {
    if (block.type !== NODE.heading) return;
    headings.push({
      index: headings.length,
      depth: headingDepth(block),
      title: nodeText(block).trim(),
      start: position,
    });
  });

  return headings.map((heading, position) => {
    const next = headings
      .slice(position + 1)
      .find((later) => later.depth <= heading.depth);
    return { ...heading, end: next ? next.start : blocks.length };
  });
}

/** 문단 하나만 담은 문서. 없는 번호면 `null`. */
export function getSection(doc: WikiDoc, index: number): WikiDoc | null {
  const section = findSections(doc)[index];
  if (!section) return null;
  return {
    type: "doc",
    content: doc.content.slice(section.start, section.end),
  };
}

/** 문단 하나를 바꾼 전체 문서. 없는 번호면 `null`. 문서 속성(분류 등)은 그대로 둔다. */
export function replaceSection(
  doc: WikiDoc,
  index: number,
  replacement: WikiDoc,
): WikiDoc | null {
  const section = findSections(doc)[index];
  if (!section) return null;

  // 편집기는 빈 문서도 빈 문단 하나로 내놓는다. 문단을 통째로 지운 것이면 빈 문단을 남기지 않는다.
  const blocks = isBlank(replacement) ? [] : replacement.content;
  const content = [
    ...doc.content.slice(0, section.start),
    ...blocks,
    ...doc.content.slice(section.end),
  ];
  return {
    ...doc,
    content: content.length > 0 ? content : [{ type: NODE.paragraph }],
  };
}

/** 글자 하나 없는 문단인가. */
export function isEmptyParagraph(node: WikiNode): boolean {
  return node.type === NODE.paragraph && (node.content ?? []).length === 0;
}

/** 빈 문단만 있는 문서인가. */
export function isBlank(doc: WikiDoc): boolean {
  return doc.content.every(isEmptyParagraph);
}
