/**
 * "같은 사람의 다른 편집" 화면 주소. `lookupId`가 없으면 사유를 받는 곳이고(이미 연 허가가 있으면
 * 그리로 넘어간다), 있으면 그 허가의 목록이다.
 */
export function authorEditsHref(revisionId: number, lookupId?: string): string {
  const base = `/admin/author-edits?from=${revisionId}`;
  return lookupId ? `${base}&lookup=${encodeURIComponent(lookupId)}` : base;
}
