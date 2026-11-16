/**
 * 자동완성이 뜰 자리인지 판단한다. 편집기와 무관한 순수 함수다.
 *
 * `[[` 뒤에서는 문서 제목, `[[분류:` 뒤에서는 분류, `{{` 뒤에서는 틀을 찾는다.
 */
export interface CompletionRequest {
  kind: "page" | "category" | "template";
  /** 사용자가 지금까지 친 검색어. */
  query: string;
  /** 고른 제목으로 바꿀 범위의 시작(커서까지 바꾼다). 여는 괄호 바로 뒤다. */
  from: number;
}

// 여는 괄호부터 커서까지, 닫는 괄호·구분자·줄바꿈이 없어야 아직 이름을 치는 중이다.
const OPEN_LINK = /\[\[([^[\]|#\n]*)$/;
const OPEN_TEMPLATE = /\{\{([^{}|\n]*)$/;

export function findCompletionRequest(
  textBeforeCursor: string,
): CompletionRequest | null {
  const link = OPEN_LINK.exec(textBeforeCursor);
  if (link) {
    const typed = link[1]!;
    const from = textBeforeCursor.length - typed.length;
    const category = /^\s*분류\s*:\s*(.*)$/.exec(typed);
    return category
      ? { kind: "category", query: category[1]!.trim(), from }
      : { kind: "page", query: typed.trim(), from };
  }

  const template = OPEN_TEMPLATE.exec(textBeforeCursor);
  if (template) {
    const typed = template[1]!;
    return {
      kind: "template",
      // `틀:`은 쳐도 되고 안 쳐도 된다. 고르면 붙여서 넣는다.
      query: typed.replace(/^\s*틀\s*:\s*/, "").trim(),
      from: textBeforeCursor.length - typed.length,
    };
  }

  return null;
}

const CLOSER = { page: "]]", category: "]]", template: "}}" } as const;

/** 고른 제목을 넣을 글자. 닫는 괄호가 이미 있으면 다시 붙이지 않는다. */
export function completionInsertText(
  request: CompletionRequest,
  title: string,
  textAfterCursor: string,
): string {
  const closer = CLOSER[request.kind];
  return textAfterCursor.startsWith(closer) ? title : `${title}${closer}`;
}

/** 자동완성 검색에 쓸 이름공간 접두사. */
export function completionNamespacePrefix(
  kind: CompletionRequest["kind"],
): string {
  if (kind === "category") return "분류:";
  if (kind === "template") return "틀:";
  return "";
}
