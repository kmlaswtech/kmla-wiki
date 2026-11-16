import { diffLines, diffWordsWithSpace } from "diff";

export interface DiffSegment {
  text: string;
  /** 줄 안에서 실제로 바뀐 부분인가. */
  changed: boolean;
}

export type DiffRow =
  | { type: "same"; text: string }
  | { type: "removed"; segments: DiffSegment[] }
  | { type: "added"; segments: DiffSegment[] }
  /** 바뀌지 않은 줄을 접은 자리. */
  | { type: "gap"; count: number };

/** 바뀐 곳 앞뒤로 보여 줄 줄 수. */
const CONTEXT_LINES = 3;

function splitLines(value: string): string[] {
  const lines = value.split("\n");
  // `diffLines`는 줄 끝 개행을 포함해 돌려주므로 마지막 빈 조각은 줄이 아니다.
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * 두 판의 줄 단위 차이. 한 줄이 한 줄로 바뀐 경우에는 줄 안에서 바뀐 낱말도 표시한다.
 * 바뀌지 않은 긴 구간은 앞뒤 몇 줄만 남기고 접는다.
 */
export function diffRevisions(before: string, after: string): DiffRow[] {
  const rows: DiffRow[] = [];
  const parts = diffLines(before, after);

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    const next = parts[index + 1];

    if (part.removed && next?.added) {
      const removed = splitLines(part.value);
      const added = splitLines(next.value);
      // 줄 수가 같을 때만 줄끼리 짝지어 낱말 차이를 낸다. 다르면 무엇이 무엇으로 바뀌었는지
      // 짐작이 되어 오히려 읽기 어렵다.
      if (removed.length === added.length) {
        removed.forEach((line, lineIndex) => {
          const words = diffWordsWithSpace(line, added[lineIndex]!);
          rows.push({
            type: "removed",
            segments: words
              .filter((word) => !word.added)
              .map((word) => ({ text: word.value, changed: word.removed })),
          });
          rows.push({
            type: "added",
            segments: words
              .filter((word) => !word.removed)
              .map((word) => ({ text: word.value, changed: word.added })),
          });
        });
      } else {
        removed.forEach((text) =>
          rows.push({ type: "removed", segments: [{ text, changed: true }] }),
        );
        added.forEach((text) =>
          rows.push({ type: "added", segments: [{ text, changed: true }] }),
        );
      }
      index++;
      continue;
    }

    const lines = splitLines(part.value);
    if (part.added || part.removed) {
      const type = part.added ? "added" : "removed";
      lines.forEach((text) =>
        rows.push({ type, segments: [{ text, changed: true }] }),
      );
      continue;
    }

    const isFirst = index === 0;
    const isLast = index === parts.length - 1;
    const head = isFirst ? 0 : CONTEXT_LINES;
    const tail = isLast ? 0 : CONTEXT_LINES;
    if (lines.length <= head + tail + 1) {
      lines.forEach((text) => rows.push({ type: "same", text }));
    } else {
      lines.slice(0, head).forEach((text) => rows.push({ type: "same", text }));
      rows.push({ type: "gap", count: lines.length - head - tail });
      lines
        .slice(lines.length - tail)
        .forEach((text) => rows.push({ type: "same", text }));
    }
  }

  return rows;
}
