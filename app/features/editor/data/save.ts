import { rebaseSectionEdit } from "../model/conflict";
import { replaceSection } from "~/features/markup";
import {
  getPageView,
  saveRevision,
  WRITE_ERROR,
  type SavedRevision,
} from "~/features/pages";
import { isWikiError } from "~/shared/supabase/errors";

export interface EditTarget {
  title: string;
  /** 편집을 시작한 판과 그때의 전체 본문. 새 문서는 `null`과 빈 문자열. */
  baseRevisionId: number | null;
  baseBody: string;
  /** 문단 편집이면 문단 번호. */
  sectionIndex: number | null;
}

export type SaveOutcome =
  | { status: "saved"; saved: SavedRevision; rebased: boolean }
  /**
   * 다른 사람이 같은 곳을 고쳤다. 내 글은 그대로 두고, 최신 판을 새 기준으로 삼아 차이를 보여 준
   * 뒤 다시 저장하게 한다.
   */
  | { status: "conflict"; latest: { revisionId: number | null; body: string } };

/** 편집기의 글(문단 편집이면 그 문단)을 전체 본문으로 만든다. 문단을 찾지 못하면 `null`. */
export function buildFullBody(target: EditTarget, text: string): string | null {
  return target.sectionIndex === null
    ? text
    : replaceSection(target.baseBody, target.sectionIndex, text);
}

/**
 * 편집을 저장한다. 저장 → 충돌이면 최신 판 확인 → 풀 수 있으면 다시 저장까지가 한 동작이다.
 *
 * 문단 편집 중에 다른 문단만 바뀌었다면 최신 판에 내 문단을 끼워 넣어 그대로 저장한다
 * (`rebased: true`). 그 밖의 충돌은 사용자가 차이를 보고 정한다.
 */
export async function saveEdit(
  target: EditTarget,
  text: string,
  summary: string,
): Promise<SaveOutcome> {
  const body = buildFullBody(target, text);
  if (body === null) {
    // 편집을 시작한 본문에서 문단을 찾지 못하는 일은 없어야 한다. 충돌과 같게 다룬다.
    return { status: "conflict", latest: await loadLatest(target.title) };
  }

  try {
    const saved = await saveRevision({
      title: target.title,
      baseRevisionId: target.baseRevisionId,
      body,
      summary,
    });
    return { status: "saved", saved, rebased: false };
  } catch (error) {
    if (!isWikiError(error, WRITE_ERROR.conflict)) throw error;
  }

  const latest = await loadLatest(target.title);

  if (target.sectionIndex !== null) {
    const rebase = rebaseSectionEdit({
      baseBody: target.baseBody,
      latestBody: latest.body,
      sectionIndex: target.sectionIndex,
      editedSection: text,
    });
    if (rebase.ok) {
      try {
        const saved = await saveRevision({
          title: target.title,
          baseRevisionId: latest.revisionId,
          body: rebase.body,
          summary,
        });
        return { status: "saved", saved, rebased: true };
      } catch (error) {
        // 그 사이 또 바뀌었다. 사용자에게 넘긴다.
        if (!isWikiError(error, WRITE_ERROR.conflict)) throw error;
        return { status: "conflict", latest: await loadLatest(target.title) };
      }
    }
  }

  return { status: "conflict", latest };
}

async function loadLatest(
  title: string,
): Promise<{ revisionId: number | null; body: string }> {
  const view = await getPageView(title, { followRedirect: false });
  return view.found
    ? {
        revisionId: view.page.currentRevisionId,
        body: view.revision?.body ?? "",
      }
    : { revisionId: null, body: "" };
}
