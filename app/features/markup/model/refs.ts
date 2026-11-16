import { stripCode } from "./code-regions";
import { REDIRECT, TEMPLATE_CALL, UPLOADED_IMAGE, WIKI_LINK } from "./syntax";
import { namespaceOf, parseTitle } from "./title";

export type RefKind = "link" | "category" | "template" | "image" | "redirect";

export interface Ref {
  kind: RefKind;
  target: string;
}

/**
 * 본문이 가리키는 것. DB의 `private.extract_refs`와 같은 답을 내야 한다.
 *
 * 저장할 때의 정본은 서버가 뽑은 값이다. 화면은 이 함수를 "넘겨주기 문서인가", "어떤 틀을 쓰는가"를
 * 미리 알 때만 쓴다. 두 쪽의 테스트가 같은 사례 표(`ref-cases.ts`)를 쓴다.
 */
export function extractRefs(body: string): Ref[] {
  const text = stripCode(body);
  const refs: Ref[] = [];

  const redirect = REDIRECT.exec(text);
  const redirectTitle = redirect ? parseTitle(redirect[1]!) : null;
  if (redirectTitle) refs.push({ kind: "redirect", target: redirectTitle });

  for (const match of text.matchAll(WIKI_LINK)) {
    const raw = match[1]!;
    // `[[#문단]]`은 같은 문서 안의 이동이라 가리키는 문서가 없다.
    if (raw.trim() === "") continue;

    const forcedLink = /^\s*:/.test(raw);
    const title = parseTitle(forcedLink ? raw.replace(/^\s*:/, "") : raw);
    if (!title) continue;

    const isCategory = !forcedLink && namespaceOf(title) === "category";
    refs.push({ kind: isCategory ? "category" : "link", target: title });
  }

  for (const match of text.matchAll(TEMPLATE_CALL)) {
    const title = parseTitle(match[1]!);
    if (title) refs.push({ kind: "template", target: title });
  }

  for (const match of text.matchAll(UPLOADED_IMAGE)) {
    refs.push({ kind: "image", target: match[1]! });
  }

  return refs;
}

/** 넘겨주기 문서면 대상 제목, 아니면 `null`. */
export function redirectTargetOf(body: string): string | null {
  const redirect = REDIRECT.exec(stripCode(body));
  return redirect ? parseTitle(redirect[1]!) : null;
}
