/**
 * 편집 중인 글의 임시 저장.
 *
 * 저장하려는 순간 회원 확인이 지나 로그인 화면을 다녀오거나, 실수로 탭을 닫아도 쓰던 글이 남는다.
 * 이 브라우저에만 저장하고 서버에는 보내지 않는다.
 */

import { isWikiDoc, type WikiDoc } from "~/features/markup";

// 본문이 글자에서 문서 구조로 바뀌어 접두사를 바꿨다. 예전 형식의 임시 저장은 읽지 않는다.
const PREFIX = "wiki:draft2:";
/** 오래된 임시 저장은 버린다. 그 사이 문서가 많이 바뀌었을 것이다. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface Draft {
  /** 편집기의 글(문단 편집이면 그 문단)과 문서 정보. */
  body: WikiDoc;
  summary: string;
  /** 편집을 시작한 판. 새 문서는 `null`. */
  baseRevisionId: number | null;
  savedAt: number;
}

function keyOf(titleKey: string, sectionIndex: number | null): string {
  return `${PREFIX}${titleKey}${sectionIndex === null ? "" : `#${sectionIndex}`}`;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // 사생활 보호 모드 등에서 접근이 막힐 수 있다. 임시 저장 없이 편집은 계속된다.
    return null;
  }
}

export function loadDraft(
  titleKey: string,
  sectionIndex: number | null,
): Draft | null {
  const raw = storage()?.getItem(keyOf(titleKey, sectionIndex));
  if (!raw) return null;

  try {
    const draft = JSON.parse(raw) as Draft;
    if (
      !isWikiDoc(draft.body) ||
      Date.now() - draft.savedAt > MAX_AGE_MS
    ) {
      clearDraft(titleKey, sectionIndex);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function saveDraft(
  titleKey: string,
  sectionIndex: number | null,
  draft: Omit<Draft, "savedAt">,
): void {
  try {
    storage()?.setItem(
      keyOf(titleKey, sectionIndex),
      JSON.stringify({ ...draft, savedAt: Date.now() }),
    );
  } catch {
    // 저장 공간이 가득 찼다. 임시 저장은 편의 기능이라 조용히 넘어간다.
  }
}

export function clearDraft(
  titleKey: string,
  sectionIndex: number | null,
): void {
  storage()?.removeItem(keyOf(titleKey, sectionIndex));
}

/** 로그아웃할 때 이 브라우저에 남은 임시 저장을 모두 지운다. */
export function clearAllDrafts(): void {
  const store = storage();
  if (!store) return;
  for (let index = store.length - 1; index >= 0; index--) {
    const key = store.key(index);
    if (key?.startsWith("wiki:draft")) store.removeItem(key);
  }
}
