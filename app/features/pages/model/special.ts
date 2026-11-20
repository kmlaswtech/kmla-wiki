import type { Namespace } from "~/features/markup";

// 특수 기능 화면(`/special`)의 탭과 주소.

export const SPECIAL_PAGE_SIZE = 100;

export const SPECIAL_TABS = [
  {
    key: "wanted",
    label: "작성이 필요한 문서",
    description: "다른 문서에서 링크했지만 아직 없는 문서입니다.",
  },
  {
    key: "orphan",
    label: "고립된 문서",
    description:
      "어느 문서도 링크하지 않아 검색으로만 찾을 수 있는 문서입니다. 관련 문서에서 링크를 걸어 주세요.",
  },
  {
    key: "redirects",
    label: "잘못된 넘겨주기",
    description: "",
  },
  {
    key: "all",
    label: "모든 문서",
    description: "넘겨주기 문서는 표시되지 않습니다.",
  },
  {
    key: "short",
    label: "짧은 문서",
    description: "",
  },
  {
    key: "long",
    label: "긴 문서",
    description: "",
  },
] as const;

/** 이름공간을 골라 볼 수 있는 탭. */
export const SPECIAL_NAMESPACE_TABS: readonly SpecialTab[] = [
  "all",
  "short",
  "long",
];

export type SpecialTab = (typeof SPECIAL_TABS)[number]["key"];

export const SPECIAL_NAMESPACES: { key: Namespace; label: string }[] = [
  { key: "main", label: "일반" },
  { key: "template", label: "틀" },
  { key: "category", label: "분류" },
  { key: "wiki", label: "위키" },
];

export function readSpecialTab(value: string | null): SpecialTab {
  return SPECIAL_TABS.some((tab) => tab.key === value)
    ? (value as SpecialTab)
    : "wanted";
}

export function readSpecialNamespace(value: string | null): Namespace {
  return SPECIAL_NAMESPACES.some((ns) => ns.key === value)
    ? (value as Namespace)
    : "main";
}

/** RPC의 `integer` 인자가 받는 가장 큰 값. 넘으면 RPC가 실패한다. */
const MAX_OFFSET = 2_147_483_647 - SPECIAL_PAGE_SIZE;

/** 크기 순 목록의 건너뛸 개수. 없거나 너무 크면 처음부터다. */
export function sizeListOffset(requested: number | null): number {
  const offset = requested ?? 0;
  return offset <= MAX_OFFSET ? offset : 0;
}

export function specialHref(
  tab: SpecialTab,
  extra: Record<string, string> = {},
): string {
  return `/special?${new URLSearchParams({ tab, ...extra }).toString()}`;
}
