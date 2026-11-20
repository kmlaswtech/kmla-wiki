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

/**
 * 이 문서에 다른 이름(이 문서로 넘겨주는 새 문서)을 더할 수 있는가. 이 문서를 고치지 않으므로 보호
 * 여부와는 상관없다. 넘겨주기 문서에 다른 이름을 달면 이중 넘겨주기가 되므로 일반 문서의 지금 판에만.
 */
export function canAddAlias(view: FoundPage): boolean {
  return (
    (view.canEdit || view.isAdmin) &&
    view.redirect === null &&
    view.page.deletedAt === null &&
    (view.revision?.isCurrent ?? false)
  );
}

/** 이 사용자가 이 문서를 고칠 수 있는가. 화면용 판단이고 실제 판정은 서버가 한다. */
export function canEditPage(view: FoundPage): boolean {
  if (view.isAdmin) return true;
  return (
    view.canEdit &&
    view.page.protection === "open" &&
    view.page.deletedAt === null
  );
}
