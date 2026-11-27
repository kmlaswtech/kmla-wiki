import { isPresetTitle, PRESET_PREFIX, type Preset } from "../model/presets";
import {
  ancestorTitles,
  asWikiDoc,
  titleKey,
  type WikiDoc,
} from "~/features/markup";
import { getSupabase } from "~/shared/supabase/client";
import { unwrap } from "~/shared/supabase/errors";

// 접두어에 `%`·`_`가 없으므로 그대로 접두어 검색이 된다.
const PRESET_PATTERN = `${titleKey(PRESET_PREFIX)}%`;

/** 살아 있는 템플릿 문서만 고르는 조회. 삭제된 문서와 넘겨주기 문서는 빠진다. */
function livePresets<Q extends string>(select: Q) {
  return getSupabase()
    .from("pages")
    .select(select)
    .like("title_key", PRESET_PATTERN)
    .is("deleted_at", null)
    .is("redirect_key", null);
}

/**
 * 템플릿 문서와 그 분류, 제목순. 넘겨주기 문서와 삭제된 문서는 빠진다. 따로 자르지 않는다(API의
 * `max_rows`가 상한이다).
 */
export async function listPresets(): Promise<Preset[]> {
  const rows = unwrap(
    await livePresets("title, page_refs(kind, target_key)")
      .not("current_revision_id", "is", null)
      .eq("page_refs.kind", "category")
      .order("title_key"),
  );
  return rows.map((row) => ({
    title: row.title,
    categoryKeys: row.page_refs.map((ref) => ref.target_key),
  }));
}

/**
 * 새 문서의 상위 문서들에 달린 분류의 제목 키. 가까운 상위의 분류가 앞에 온다. 상위 문서가 없거나
 * 아직 만들지 않았으면 빈 목록.
 */
export async function listAncestorCategories(title: string): Promise<string[]> {
  const ancestors = ancestorTitles(title).reverse();
  if (ancestors.length === 0) return [];
  const rows = unwrap(
    await getSupabase()
      .from("pages")
      .select("title_key, page_refs(kind, target_key)")
      .in("title_key", ancestors.map(titleKey))
      .eq("page_refs.kind", "category"),
  );
  const byKey = new Map(rows.map((row) => [row.title_key, row.page_refs]));
  const keys = ancestors.flatMap((ancestor) =>
    (byKey.get(titleKey(ancestor)) ?? []).map((ref) => ref.target_key),
  );
  return [...new Set(keys)];
}

/** 템플릿의 지금 본문. 그 사이 지워졌거나, 넘겨주기가 되었거나, 볼 수 없으면 `null`. */
export async function getPresetBody(title: string): Promise<WikiDoc | null> {
  const [row] = unwrap(
    await livePresets("revision:revisions!pages_current_revision_fkey(body)")
      .eq("title_key", titleKey(title))
      .limit(1),
  );
  return row?.revision ? asWikiDoc(row.revision.body) : null;
}

/** 그 제목의 문서가 이미 있는가(넘겨주기 문서 포함). */
export async function pageExists(title: string): Promise<boolean> {
  const rows = unwrap(
    await getSupabase()
      .from("pages")
      .select("id")
      .eq("title_key", titleKey(title))
      .limit(1),
  );
  return rows.length > 0;
}

export interface PresetStartData {
  presets: Preset[];
  /** `listAncestorCategories`. */
  ancestorCategories: string[];
  /** 주소로 고른 템플릿(`?preset=`)의 제목. */
  presetTitle: string | null;
  /** 그 템플릿의 본문. 없거나 템플릿이 아니면 `null`. */
  initialBody: WikiDoc | null;
}

/**
 * 새 문서 편집 화면이 템플릿에 쓰는 것을 한 번에 받는다. 모두 보조 정보라, 못 받은 것은 비워 두고
 * 편집은 막지 않는다.
 */
export async function loadPresetStart(
  title: string,
  presetTitle: string | null,
): Promise<PresetStartData> {
  // 템플릿 문서 자체를 만들 때는 템플릿으로 시작하지 않는다.
  if (isPresetTitle(title)) {
    return {
      presets: [],
      ancestorCategories: [],
      presetTitle,
      initialBody: null,
    };
  }
  const [presets, ancestorCategories, initialBody] = await Promise.all([
    listPresets().catch(() => []),
    listAncestorCategories(title).catch(() => []),
    presetTitle && isPresetTitle(presetTitle)
      ? getPresetBody(presetTitle).catch(() => null)
      : null,
  ]);
  return { presets, ancestorCategories, presetTitle, initialBody };
}
