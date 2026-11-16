import { getSection, replaceSection } from "~/features/markup";

/**
 * 편집 충돌을 풀 수 있는지 본다.
 *
 * 문서 전체를 고쳤다면 자동으로 합치지 않는다. 문단 하나만 고쳤다면, 그 문단이 내가 편집을 시작한
 * 뒤로 바뀌지 않았을 때 최신 판의 같은 문단에 내 글을 다시 끼워 넣을 수 있다. 다른 사람이 다른
 * 문단을 고친 흔한 경우를 사용자가 모르고 지나가게 한다.
 */
export type RebaseResult =
  /** 최신 판에 내 문단을 끼워 넣은 전체 본문. */
  | { ok: true; body: string }
  /** 같은 문단을 다른 사람도 고쳤거나, 문단 구성이 바뀌어 자리를 찾을 수 없다. */
  | { ok: false };

export function rebaseSectionEdit(input: {
  /** 내가 편집을 시작할 때의 전체 본문. */
  baseBody: string;
  /** 지금의 최신 전체 본문. */
  latestBody: string;
  sectionIndex: number;
  /** 내가 고친 문단. */
  editedSection: string;
}): RebaseResult {
  const original = getSection(input.baseBody, input.sectionIndex);
  const current = getSection(input.latestBody, input.sectionIndex);
  if (original === null || current === null) return { ok: false };

  // 문단 끝의 빈 줄 차이는 뒤 문단이 바뀌어도 생기므로 무시한다.
  if (original.trimEnd() !== current.trimEnd()) return { ok: false };

  const body = replaceSection(
    input.latestBody,
    input.sectionIndex,
    input.editedSection,
  );
  return body === null ? { ok: false } : { ok: true, body };
}

/** 본문의 절반 넘게 지우는 편집인가. 저장 전에 한 번 묻는다. */
export function isLargeDeletion(before: string, after: string): boolean {
  const beforeLength = before.trim().length;
  // 짧은 문서는 몇 글자만 지워도 절반이 넘는다.
  if (beforeLength < 200) return false;
  return after.trim().length < beforeLength / 2;
}
