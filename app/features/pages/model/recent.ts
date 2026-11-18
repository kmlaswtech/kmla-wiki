import type { RecentChange } from "./types";

/**
 * 최근 변경에서 문서마다 가장 새 판 하나만 남겨 앞에서부터 `limit`개를 고른다.
 *
 * 곁의 최근 변경 목록이 쓴다. 한 문서를 여러 번 고치면 목록이 그 문서로만 차기 때문이다.
 * `changes`는 새 판이 앞에 오는 순서여야 한다(`listRecentChanges`).
 */
export function latestChangePerPage(
  changes: readonly RecentChange[],
  limit: number,
): RecentChange[] {
  const seen = new Set<string>();
  const picked: RecentChange[] = [];
  for (const change of changes) {
    if (picked.length >= limit) break;
    if (seen.has(change.pageTitle)) continue;
    seen.add(change.pageTitle);
    picked.push(change);
  }
  return picked;
}
