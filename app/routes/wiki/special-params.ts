import { nonNegativeInt } from "./title-param";
import type { Namespace } from "~/features/markup";
import { SPECIAL_PAGE_SIZE } from "~/features/pages";

// 특수 기능 화면의 탭과 주소. loader와 화면이 같이 쓰므로 라우트 모듈 밖에 둔다. 라우트 모듈 안에 두면
// loader를 따로 떼어 내지 못한다(`react-router.config.ts`의 `splitRouteModules`).

export const TABS = [
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
export const NAMESPACE_TABS: readonly Tab[] = ["all", "short", "long"];

export type Tab = (typeof TABS)[number]["key"];

export const NAMESPACES: { key: Namespace; label: string }[] = [
  { key: "main", label: "일반" },
  { key: "template", label: "틀" },
  { key: "category", label: "분류" },
  { key: "wiki", label: "위키" },
];

export function readTab(value: string | null): Tab {
  return TABS.some((tab) => tab.key === value) ? (value as Tab) : "wanted";
}

export function readNamespace(value: string | null): Namespace {
  return NAMESPACES.some((ns) => ns.key === value)
    ? (value as Namespace)
    : "main";
}

/** RPC의 `integer` 인자가 받는 가장 큰 값. 넘으면 RPC가 실패한다. */
const MAX_OFFSET = 2_147_483_647 - SPECIAL_PAGE_SIZE;

/** 크기 순 목록의 건너뛸 개수. 잘못된 값이면 처음부터다. */
export function readOffset(value: string | null): number {
  const offset = nonNegativeInt(value) ?? 0;
  return offset <= MAX_OFFSET ? offset : 0;
}

export function specialHref(
  tab: Tab,
  extra: Record<string, string> = {},
): string {
  return `/special?${new URLSearchParams({ tab, ...extra }).toString()}`;
}
