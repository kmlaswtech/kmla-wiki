import { ancestorTitles, pageHref, titleKey } from "~/features/markup";

/**
 * 문서 템플릿. 이 제목 아래의 문서(`위키:템플릿/귀가`)가 템플릿이다. 새 문서를 만들 때 템플릿 본문을
 * 복사해 시작한다. 복사한 뒤에는 템플릿과 이어지지 않는다(틀과 다르다). `위키:템플릿` 자체는 템플릿이
 * 아니라 보통 문서다. DB의 `get_page_view`(분류의 `presets`)도 같은 접두어를 쓴다.
 */
export const PRESET_PREFIX = "위키:템플릿/";

/** 시작하기 상자에 단추로 보이는 추천 템플릿 수. 나머지는 고르기 대화상자에서 고른다. */
const MAX_SUGGESTIONS = 3;

export interface Preset {
  title: string;
  /** 템플릿에 달린 분류의 제목 키(`분류:귀가` → `분류:귀가`의 소문자). */
  categoryKeys: string[];
}

/** 편집 화면 주소에 붙이는 템플릿 값의 이름. `/edit/제목?preset=위키:템플릿/귀가`. */
export const PRESET_PARAM = "preset";

/** 템플릿을 채워 새 문서를 여는 편집 화면 주소. */
export function presetEditHref(title: string, presetTitle: string): string {
  return `${pageHref(title, "edit")}?${new URLSearchParams({ [PRESET_PARAM]: presetTitle })}`;
}

export function isPresetTitle(title: string): boolean {
  return title.startsWith(PRESET_PREFIX);
}

/** 보이는 이름. `위키:템플릿/귀가` → `귀가`. */
export function presetLabel(presetTitle: string): string {
  return presetTitle.slice(PRESET_PREFIX.length);
}

/**
 * 새 문서에 추천할 템플릿. 앞에 둔 것부터 `MAX_SUGGESTIONS`개까지.
 *
 *  1. 경로: 상위 경로마다 같은 이름의 템플릿(가까운 상위부터). `귀가/정기 귀가`면 `위키:템플릿/귀가`.
 *     문서 자신의 제목은 보지 않는다. `귀가` 개요 문서에 `귀가` 템플릿을 권하지 않기 위해서다.
 *  2. 분류: `categoryKeys`(상위 문서의 분류, 쓰는 사람이 단 분류)를 앞에서부터 보고, 그 분류가 달린
 *     템플릿을 제목순으로.
 *
 * 템플릿 문서 자체를 만드는 중이면 추천하지 않는다.
 */
export function suggestPresets(
  pageTitle: string,
  presets: readonly Preset[],
  categoryKeys: readonly string[],
): string[] {
  if (isPresetTitle(pageTitle)) return [];
  const byKey = new Map(
    presets.map((preset) => [titleKey(preset.title), preset]),
  );
  const found = new Set<string>();

  for (const path of ancestorTitles(pageTitle).reverse()) {
    const preset = byKey.get(titleKey(`${PRESET_PREFIX}${path}`));
    if (preset) found.add(preset.title);
  }
  for (const category of categoryKeys) {
    for (const preset of presets) {
      if (preset.categoryKeys.includes(category)) found.add(preset.title);
    }
  }
  return [...found].slice(0, MAX_SUGGESTIONS);
}

/** 고르기 대화상자의 검색. 보이는 이름에 검색어가 들어 있으면 남긴다. 대소문자는 가리지 않는다. */
export function filterPresets(
  presets: readonly Preset[],
  query: string,
): Preset[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...presets];
  return presets.filter((preset) =>
    presetLabel(preset.title).toLowerCase().includes(needle),
  );
}
