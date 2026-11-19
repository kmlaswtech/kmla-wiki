import type { FoundPage } from "./types";

/**
 * 이 문서로 오는 넘겨주기의 제목. 일반 문서는 `aliases`가 곧 이것이지만, 넘겨주기 문서를 볼 때는
 * `aliases`가 비고 그리로 오는 넘겨주기(이중 넘겨주기)가 `backlinks`에 섞여 온다.
 */
export function redirectsHere(view: FoundPage): string[] {
  return [
    ...view.aliases,
    ...view.backlinks
      .filter((link) => link.isRedirect)
      .map((link) => link.title),
  ];
}
