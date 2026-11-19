import { Node as PMNode } from "@tiptap/pm/model";

import { wikiSchema } from "./schema";
import {
  emptyDoc,
  isEmptyParagraph,
  normalizeCategories,
  parseTitle,
  type WikiDoc,
  type WikiNode,
} from "~/features/markup";

/** 본문 흐름 밖의 문서 정보. 편집기 아래의 따로 된 입력 칸에서 고친다. */
export interface DocMeta {
  /** 분류 문서 제목(`분류:생활`). */
  categories: string[];
  /** 넘겨주기 대상. 넘겨주기 문서가 아니면 빈 글자. */
  redirect: string;
}

/** 편집기에 넣을 본문과 따로 고칠 문서 정보로 나눈다. */
export function splitDoc(doc: WikiDoc): { content: WikiDoc; meta: DocMeta } {
  return {
    content: { type: "doc", content: doc.content },
    meta: {
      categories: doc.attrs?.categories ?? [],
      redirect: doc.attrs?.redirect ?? "",
    },
  };
}

/**
 * 편집기 본문과 문서 정보를 저장할 문서 하나로 합친다.
 *
 * 같은 내용은 언제나 같은 값이 되게 맞춘다: 끝의 빈 문단을 떼고, 분류는 제목으로 바꿔 겹친 것을
 * 빼고, 빈 문서 정보는 적지 않는다. 그래야 "바뀐 것이 있는가"를 값 비교로 알 수 있다.
 */
export function joinDoc(content: WikiDoc, meta: DocMeta): WikiDoc {
  const blocks = [...content.content];
  while (blocks.length > 1 && isEmptyParagraph(blocks.at(-1)!)) blocks.pop();

  const categories = normalizeCategories(meta.categories);
  const redirect = parseTitle(meta.redirect);

  const doc: WikiDoc = {
    type: "doc",
    content: blocks.length > 0 ? blocks : emptyDoc().content,
  };
  if (categories.length > 0 || redirect) {
    doc.attrs = {
      ...(categories.length > 0 ? { categories } : {}),
      ...(redirect ? { redirect } : {}),
    };
  }
  return doc;
}

/** 넘겨주기 문서의 본문. 본문과 분류 없이 대상만 둔다(DB가 다른 모양은 거부한다). */
export function redirectDoc(target: string): WikiDoc {
  return {
    type: "doc",
    content: emptyDoc().content,
    attrs: { redirect: target },
  };
}

/**
 * 저장된 문서를 편집기 스키마로 한 번 읽어 다시 쓴다. 기본 속성이 채워지고 키 순서가 맞춰져,
 * 편집기가 내놓는 값과 그대로 비교할 수 있다. 편집기가 모르는 노드·마크는 버린다.
 */
export function normalizeDoc(doc: WikiDoc): WikiDoc {
  const { content, meta } = splitDoc(doc);
  const known = pruneUnknown({
    type: "doc",
    content: content.content,
  }) as WikiDoc;
  try {
    const node = PMNode.fromJSON(wikiSchema(), known);
    return joinDoc(node.toJSON() as WikiDoc, meta);
  } catch {
    return joinDoc(known, meta);
  }
}

/** 스키마에 없는 노드와 마크를 뺀다. 예전 형식이나 조작된 본문이 편집기를 깨뜨리지 않게. */
function pruneUnknown(node: WikiNode): WikiNode {
  const schema = wikiSchema();
  const marks = node.marks?.filter((mark) => mark.type in schema.marks);
  const content = node.content
    ?.filter((child) => child.type in schema.nodes)
    .map(pruneUnknown);
  return {
    ...node,
    ...(node.marks ? { marks } : {}),
    ...(node.content ? { content } : {}),
  };
}

/** 키 순서와 상관없는 비교용 글자. DB(jsonb)는 키 순서를 지키지 않는다. */
export function stableKey(value: unknown): string {
  return JSON.stringify(value, (_, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : item,
  );
}

/**
 * 두 문서가 같은가. 어디서 왔든(DB는 키 순서를 지키지 않는다) 비교할 수 있다. 둘 다
 * `normalizeDoc`·`joinDoc`을 거친 값이면 키 순서가 같으므로 `JSON.stringify`로 바로 비교해도 된다
 * (편집 화면이 글자를 칠 때마다 그렇게 한다).
 */
export function sameDoc(a: WikiDoc, b: WikiDoc): boolean {
  return stableKey(a) === stableKey(b);
}
