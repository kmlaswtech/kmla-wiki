import { positiveInt } from "./query-param";

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
  /** 가장 새로운 쪽인가. 아니면 "처음" 단추를 둔다. */
  atStart: boolean;
}

/** 주소의 쿼리에서 커서를 읽는다. 둘 다 있으면 `before`를 쓴다. 이상한 값은 없는 것과 같다. */
export function readPageCursor(params: URLSearchParams): PageCursor {
  const before = positiveInt(params.get("before"));
  if (before !== undefined) return { kind: "before", id: before };
  const after = positiveInt(params.get("after"));
  if (after !== undefined) return { kind: "after", id: after };
  return { kind: "first" };
}

/** `keysetQuery`가 쓰는 PostgREST 조회의 꼴. */
interface KeysetBuilder<Q> {
  order(column: "id", options: { ascending: boolean }): Q;
  limit(count: number): Q;
  lt(column: "id", value: number): Q;
  gt(column: "id", value: number): Q;
}

/**
 * 조회에 커서의 범위와 순서를 붙인다. `after`는 오름차순으로 읽어야 바로 앞 쪽이 나온다. 한 개 더
 * 읽어서(`size + 1`) 그쪽에 더 있는지 안다.
 */
export function keysetQuery<Q extends KeysetBuilder<Q>>(
  query: Q,
  cursor: PageCursor,
  size: number,
): Q {
  const ordered = query
    .order("id", { ascending: cursor.kind === "after" })
    .limit(size + 1);
  if (cursor.kind === "before") return ordered.lt("id", cursor.id);
  if (cursor.kind === "after") return ordered.gt("id", cursor.id);
  return ordered;
}

/** 한 개 더 읽은 행을 한 쪽으로 자른다. `more`면 그 뒤에 더 있다. */
export function takePage<T>(
  rows: readonly T[],
  size: number,
): { rows: T[]; more: boolean } {
  return { rows: rows.slice(0, size), more: rows.length > size };
}

/**
 * `keysetQuery`로 읽은 행에서 한 쪽(최신순)과 앞뒤 커서를 만든다. 빈 쪽(지난 커서)에는 앞뒤 커서가
 * 없고 "처음"으로만 간다.
 */
export function keysetPage<T extends { id: number }>(
  rows: readonly T[],
  cursor: PageCursor,
  size: number,
): KeysetPage<T> {
  const { rows: kept, more } = takePage(rows, size);
  const items = cursor.kind === "after" ? kept.reverse() : kept;
  const newest = items[0]?.id ?? null;
  const oldest = items.at(-1)?.id ?? null;
  if (cursor.kind === "after") {
    return {
      items,
      newer: more ? newest : null,
      older: oldest,
      atStart: !more && items.length > 0,
    };
  }
  return {
    items,
    newer: cursor.kind === "before" ? newest : null,
    older: more ? oldest : null,
    atStart: cursor.kind === "first",
  };
}

/** 쪽 넘기기 단추의 주소. `null`이면 그 단추는 갈 곳이 없다. */
export function keysetHrefs(
  path: string,
  page: Omit<KeysetPage<unknown>, "items">,
): { first: string | null; prev: string | null; next: string | null } {
  return {
    first: page.atStart ? null : path,
    prev: page.newer === null ? null : `${path}?after=${page.newer}`,
    next: page.older === null ? null : `${path}?before=${page.older}`,
  };
}
