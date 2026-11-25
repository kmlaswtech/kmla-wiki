/**
 * 번호 내림차순(최신순) 목록을 번호로 끊어 읽는다(keyset). 주소의 `before=N`은 N보다 오래된 쪽,
 * `after=N`은 N보다 새로운 쪽이다. 둘 다 없으면 가장 새로운 쪽이다.
 *
 * 쪽 번호(offset)를 쓰지 않는 이유: 새 행이 앞에 늘 붙는 목록이라 offset이면 쪽을 넘길 때 행이
 * 겹치거나 빠진다. 전체 수를 세지 않아도 된다.
 */
export type PageCursor =
  | { kind: "first" }
  | { kind: "before"; id: number }
  | { kind: "after"; id: number };

/** 한 쪽과 앞뒤 쪽의 커서. 커서가 `null`이면 그쪽에 더 없다. */
export interface KeysetPage<T> {
  items: T[];
  /** 더 새로운 쪽의 `after` 값. */
  newer: number | null;
  /** 더 오래된 쪽의 `before` 값. */
  older: number | null;
}

/** 주소의 쿼리에서 커서를 읽는다. 둘 다 있으면 `before`를 쓴다. 이상한 값은 없는 것과 같다. */
export function readPageCursor(params: URLSearchParams): PageCursor {
  const before = positiveId(params.get("before"));
  if (before !== null) return { kind: "before", id: before };
  const after = positiveId(params.get("after"));
  if (after !== null) return { kind: "after", id: after };
  return { kind: "first" };
}

/**
 * 커서로 읽을 범위. `after`는 오름차순으로 읽어야 바로 앞 쪽이 나온다. 한 개 더 읽어서 그쪽에
 * 더 있는지 안다.
 */
export function keysetRange(
  cursor: PageCursor,
  size: number,
): { lt?: number; gt?: number; ascending: boolean; limit: number } {
  const limit = size + 1;
  if (cursor.kind === "before")
    return { lt: cursor.id, ascending: false, limit };
  if (cursor.kind === "after") return { gt: cursor.id, ascending: true, limit };
  return { ascending: false, limit };
}

/** `keysetRange`로 읽은 행에서 한 쪽(최신순)과 앞뒤 커서를 만든다. */
export function keysetPage<T>(
  rows: readonly T[],
  cursor: PageCursor,
  size: number,
  idOf: (row: T) => number,
): KeysetPage<T> {
  const more = rows.length > size;
  const kept = rows.slice(0, size);
  const items = cursor.kind === "after" ? kept.reverse() : kept;
  const newest = items[0];
  const oldest = items.at(-1);
  if (cursor.kind === "after") {
    return {
      items,
      newer: more && newest !== undefined ? idOf(newest) : null,
      // `after`의 행 자체가 더 오래된 쪽에 있다.
      older: oldest !== undefined ? idOf(oldest) : cursor.id + 1,
    };
  }
  return {
    items,
    // `before`의 행 자체가 더 새로운 쪽에 있다.
    newer:
      cursor.kind === "before"
        ? newest !== undefined
          ? idOf(newest)
          : cursor.id - 1
        : null,
    older: more && oldest !== undefined ? idOf(oldest) : null,
  };
}

/** 앞뒤 쪽의 주소(`path?after=N`, `path?before=N`). `null`이면 그쪽에 쪽이 없다. */
export function keysetHrefs(
  path: string,
  page: Pick<KeysetPage<unknown>, "newer" | "older">,
): { newer: string | null; older: string | null } {
  const href = (key: "before" | "after", id: number | null) =>
    id === null || id <= 0 ? null : `${path}?${key}=${id}`;
  return {
    newer: href("after", page.newer),
    older: href("before", page.older),
  };
}

function positiveId(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
