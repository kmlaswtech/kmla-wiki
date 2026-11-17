import {
  IMAGE_ID,
  MARK,
  NODE,
  stringAttr,
  walk,
  type WikiDoc,
  type WikiNode,
} from "./doc";
import { parseTitle } from "./title";

export type RefKind = "link" | "category" | "template" | "image" | "redirect";

export interface Ref {
  kind: RefKind;
  target: string;
}

/** 틀 노드의 이름을 틀 문서 제목으로. `틀:`을 빼고 적었어도 같은 틀이다. */
export function templateTitle(name: string): string | null {
  const title = parseTitle(name);
  if (!title) return null;
  return title.startsWith("틀:") ? title : parseTitle(`틀:${title}`);
}

/** 분류 이름 목록을 분류 문서 제목 목록으로. 쓸 수 없는 이름은 빼고, 겹친 것은 하나만 둔다. */
export function normalizeCategories(names: readonly unknown[]): string[] {
  const titles = names
    .map((name) => (typeof name === "string" ? categoryTitle(name) : null))
    .filter((title): title is string => title !== null);
  return [...new Set(titles)];
}

/** 분류 이름을 분류 문서 제목으로. `분류:`를 빼고 적었어도 같은 분류다. */
export function categoryTitle(name: string): string | null {
  const title = parseTitle(name);
  if (!title) return null;
  return title.startsWith("분류:") ? title : parseTitle(`분류:${title}`);
}

/**
 * 본문이 가리키는 것. DB의 `private.extract_refs`와 같은 답을 내야 한다.
 *
 * 저장할 때의 정본은 서버가 뽑은 값이다. 화면은 미리 알아야 할 때만 쓴다. 두 쪽의 테스트가 같은
 * 사례 표(`ref-cases.ts`)를 쓴다.
 */
export function extractRefs(doc: WikiDoc): Ref[] {
  const refs: Ref[] = [];

  // 넘겨주기는 대상으로 가는 링크이기도 하다(역링크에 넘겨주기 문서가 보인다).
  const redirect = redirectTargetOf(doc);
  if (redirect) {
    refs.push({ kind: "redirect", target: redirect });
    refs.push({ kind: "link", target: redirect });
  }

  for (const title of normalizeCategories(doc.attrs?.categories ?? [])) {
    refs.push({ kind: "category", target: title });
  }

  walk(doc.content, (node: WikiNode) => {
    for (const mark of node.marks ?? []) {
      if (mark.type !== MARK.wikiLink) continue;
      // 대상이 비면 같은 문서 안의 문단으로 가는 링크다.
      const title = parseTitle(stringAttr(mark, "target"));
      if (title) refs.push({ kind: "link", target: title });
    }
    if (node.type === NODE.template) {
      const title = templateTitle(stringAttr(node, "name"));
      if (title) refs.push({ kind: "template", target: title });
    }
    if (node.type === NODE.image) {
      const id = stringAttr(node, "id");
      if (IMAGE_ID.test(id)) refs.push({ kind: "image", target: id });
    }
  });

  return refs;
}

/** 넘겨주기 문서면 대상 제목, 아니면 `null`. */
export function redirectTargetOf(doc: WikiDoc): string | null {
  const target = doc.attrs?.redirect;
  return typeof target === "string" ? parseTitle(target) : null;
}
