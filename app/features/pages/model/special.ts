import type { Namespace } from "~/features/markup";

// 특수 기능 화면(`/special`)의 탭과 주소.

export const SPECIAL_PAGE_SIZE = 100;

export const SPECIAL_TABS = [
  {
    key: "wanted",
    label: "작성이 필요한 문서",
    description: "다른 문서에 링크가 있지만 아직 작성되지 않은 문서입니다.",
  },
  {
    key: "orphan",
    label: "고립된 문서",
    description: "다른 문서에서 링크하지 않은 문서입니다.",
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

/** 쪽 넘기기 단추의 주소. `null`이면 그 단추는 갈 곳이 없다. */
export interface SpecialNav {
  first: string | null;
  prev: string | null;
  next: string | null;
}

/**
 * 크기 순 목록(짧은·긴 문서)의 쪽 넘기기. 건너뛸 개수(`offset`)로 앞뒤로 간다. `more`면 다음 쪽이
 * 있다.
 */
export function sizeListNav(
  tab: SpecialTab,
  namespace: Namespace,
  offset: number,
  more: boolean,
): SpecialNav {
  const ns = { ns: namespace };
  const at = (value: number) =>
    specialHref(tab, value > 0 ? { ...ns, offset: String(value) } : ns);
  return {
    first: offset > 0 ? at(0) : null,
    prev: offset > 0 ? at(Math.max(0, offset - SPECIAL_PAGE_SIZE)) : null,
    next: more ? at(offset + SPECIAL_PAGE_SIZE) : null,
  };
}

/**
 * 제목 순 목록(전체·고립 문서)의 쪽 넘기기. RPC가 마지막 제목 다음부터만 읽으므로(`after`) 앞 쪽으로
 * 가는 단추가 없다. 고립 문서는 이름공간을 나누지 않는다.
 */
export function titleListNav(
  tab: SpecialTab,
  namespace: Namespace,
  after: string | undefined,
  last: string | undefined,
  more: boolean,
): SpecialNav {
  const ns: Record<string, string> = tab === "orphan" ? {} : { ns: namespace };
  return {
    first: after !== undefined ? specialHref(tab, ns) : null,
    prev: null,
    next: more && last ? specialHref(tab, { ...ns, after: last }) : null,
  };
}
