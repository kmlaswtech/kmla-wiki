import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { wikiSchema } from "~/features/editor/model/schema";
import { MARK, NODE } from "~/features/markup";

/**
 * 노드·마크 이름은 편집기 스키마, `NODE`·`MARK` 상수, DB 함수 세 곳에 따로 있다. 어긋나면 편집기는
 * 저장하지만 문서 보기는 모르는 노드로 보고 버린다. 오류가 나지 않으므로 여기서 잡는다.
 */
describe("node and mark names", () => {
  it("matches the editor schema", () => {
    const schema = wikiSchema();
    expect(new Set(Object.keys(schema.nodes))).toEqual(
      new Set(Object.values(NODE)),
    );
    expect(new Set(Object.keys(schema.marks))).toEqual(
      new Set(Object.values(MARK)),
    );
  });

  it("covers every name the database functions use", () => {
    const dir = fileURLToPath(
      new URL("../../../../supabase/schemas/", import.meta.url),
    );
    const sql = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => readFileSync(join(dir, file), "utf8"))
      .join("\n");
    // jsonpath(`@.type == "link"`)와 노드를 만드는 곳(`'type', 'heading'`)만 찾는다. 지금 SQL이
    // 노드 이름을 쓰는 꼴은 이 둘뿐이다(`->> 'type'`은 `'doc'` 비교에만 쓴다). 다른 꼴(`in (...)`,
    // `like_regex`)로 이름을 쓰면 여기에 더한다.
    const pattern = /@\.type\s*[!=]=\s*"(\w+)"|'type',\s*'(\w+)'/g;
    const used = new Set(
      [...sql.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? ""),
    );
    expect(used.size).toBeGreaterThan(0);

    const known = new Set<string>([
      ...Object.values(NODE),
      ...Object.values(MARK),
    ]);
    expect([...used].filter((name) => !known.has(name))).toEqual([]);
  });
});
