import { Node as PMNode } from "@tiptap/pm/model";

import { wikiSchema } from "./schema";
import {
  emptyDoc,
  isEmptyParagraph,
  isEmptyProfile,
  normalizeCategories,
  profileOf,
  type WikiDoc,
  type WikiDocAttrs,
  type WikiNode,
  type WikiProfile,
} from "~/features/markup";

/** 본문 흐름 밖의 문서 정보. 본문 편집기와 따로 된 입력 칸에서 고친다. */
export interface DocMeta {
  /** 분류 문서 제목(`분류:생활`). */
  categories: string[];
  /** 프로필 블록. 없으면 `null`. 본문과 따로 된 편집기에서 고친다. */
  profile: WikiProfile | null;
}

/**
 * 편집기에 넣을 본문과 따로 고칠 문서 정보로 나눈다.
 *
 * 넘겨주기는 본문 편집기에서 다루지 않는다(`RedirectForm`, `redirectDoc`). 그래서 나누면 빠진다.
 * 넘겨주기 문서를 본문 편집기로 열어 저장하면 넘겨주기가 풀린다.
 */
export function splitDoc(doc: WikiDoc): { content: WikiDoc; meta: DocMeta } {
  return {
    content: { type: "doc", content: doc.content },
    meta: {
      categories: doc.attrs?.categories ?? [],
      profile: profileOf(doc),
    },
  };
}

/**
 * 편집기 본문과 문서 정보를 저장할 문서 하나로 합친다.
 *
 * 같은 내용은 언제나 같은 값이 되게 맞춘다: 끝의 빈 문단을 떼고, 분류는 제목으로 바꿔 겹친 것을
 * 빼고, 빈 문서 정보(빈 프로필 포함)는 적지 않는다. 그래야 "바뀐 것이 있는가"를 값 비교로 알 수 있다.
 */
export function joinDoc(content: WikiDoc, meta: DocMeta): WikiDoc {
  const blocks = trimTrailingEmpty(content.content.map(omitUnsetStyle));

  const categories = normalizeCategories(meta.categories);

  const doc: WikiDoc = {
    type: "doc",
    content: blocks.length > 0 ? blocks : emptyDoc().content,
  };
  const attrs: WikiDocAttrs = {};
  if (categories.length > 0) attrs.categories = categories;
  if (meta.profile && !isEmptyProfile(meta.profile)) {
    attrs.profile = trimTrailingEmpty(meta.profile.map(omitUnsetStyle));
  }
  if (Object.keys(attrs).length > 0) doc.attrs = attrs;
  return doc;
}

/** 끝의 빈 문단을 뗀다(하나는 남긴다). */
function trimTrailingEmpty(blocks: WikiNode[]): WikiNode[] {
  while (blocks.length > 1 && isEmptyParagraph(blocks.at(-1)!)) blocks.pop();
  return blocks;
}

/**
 * 고르지 않은(`null`) 꾸밈 속성. 편집기는 모든 문단·셀에 기본값을 적어 내놓는다. 그대로 저장하면
 * 문단마다 `"textAlign": null`이 붙어 본문이 커지고, 이 기능 전에 저장한 문서와 값이 달라진다.
 */
const UNSET_STYLE_ATTRS: ReadonlySet<string> = new Set([
  "textAlign",
  "background",
]);

function isUnsetStyle([name, value]: [string, unknown]): boolean {
  return value === null && UNSET_STYLE_ATTRS.has(name);
}

/** 고칠 것이 없는 노드는 그대로 돌려준다. 입력할 때마다 부르므로 모든 노드를 복사하지 않는다. */
function omitUnsetStyle(node: WikiNode): WikiNode {
  const entries = node.attrs ? Object.entries(node.attrs) : [];
  const stripAttrs = entries.some(isUnsetStyle);
  const content = node.content?.map(omitUnsetStyle);
  const contentChanged =
    content !== undefined &&
    content.some((child, index) => child !== node.content![index]);
  if (!stripAttrs && !contentChanged) return node;

  // 키 순서를 지킨다(펼친 객체에서 같은 키를 덮어쓰면 자리가 그대로다).
  const result: WikiNode = { ...node };
  if (stripAttrs) {
    const kept = entries.filter((entry) => !isUnsetStyle(entry));
    if (kept.length > 0) result.attrs = Object.fromEntries(kept);
    else delete result.attrs;
  }
  if (contentChanged) result.content = content;
  return result;
}

/**
 * 저장된 문서를 편집기 스키마로 한 번 읽어 다시 쓴다. 기본 속성이 채워지고 키 순서가 맞춰져,
 * 편집기가 내놓는 값과 그대로 비교할 수 있다. 편집기가 모르는 노드·마크는 버린다.
 */
export function normalizeDoc(doc: WikiDoc): WikiDoc {
  const { content, meta } = splitDoc(doc);
  const profile = meta.profile ? normalizeBlocks(meta.profile).content : null;
  return joinDoc(normalizeBlocks(content.content), { ...meta, profile });
}

/** 블록 목록을 편집기 스키마로 한 번 읽어 다시 쓴다. 읽지 못하면 모르는 것만 뺀 값. */
function normalizeBlocks(blocks: readonly WikiNode[]): WikiDoc {
  const known = pruneUnknown({ type: "doc", content: [...blocks] }) as WikiDoc;
  try {
    return PMNode.fromJSON(wikiSchema(), known).toJSON() as WikiDoc;
  } catch {
    return known;
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
