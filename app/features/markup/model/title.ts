/**
 * 문서 제목 규칙. 제목이 곧 주소다.
 *
 * DB의 `private.normalize_title` · `is_valid_title` · `title_key`와 같은 규칙이어야 한다. 서버가
 * 정본이고 여기는 화면이 같은 답을 미리 알기 위한 거울이다. 한쪽을 고치면 다른 쪽도 고친다.
 */

export type Namespace = "main" | "template" | "category" | "wiki";

const NAMESPACE_PREFIX: Record<Exclude<Namespace, "main">, string> = {
  template: "틀:",
  category: "분류:",
  wiki: "위키:",
};

const MAX_TITLE_LENGTH = 100;

/** 공백·밑줄 묶음은 공백 하나로, `/`와 이름공간 `:` 둘레의 공백은 없앤다. 빈 제목은 `null`. */
export function normalizeTitle(raw: string): string | null {
  const title = raw
    .normalize("NFC")
    .replace(/[\s_]+/g, " ")
    .trim()
    .replace(/ *\/ */g, "/")
    .replace(/^(틀|분류|위키) *: */, "$1:");
  return title === "" ? null : title;
}

/** 금지 문자는 위키 문법과 주소에서 뜻이 있는 것들이다. */
export function isValidTitle(title: string): boolean {
  return (
    [...title].length >= 1 &&
    [...title].length <= MAX_TITLE_LENGTH &&
    // eslint-disable-next-line no-control-regex -- 제어 문자를 막는 것이 목적이다.
    !/[[\]{}|#<>\\\u0000-\u001f\u007f]/.test(title) &&
    !/^[/:]/.test(title) &&
    !title.endsWith("/") &&
    !title.includes("//") &&
    !/(^|\/)\.{1,2}(\/|$)/.test(title) &&
    !/^(틀|분류|위키):$/.test(title)
  );
}

/** 정규화와 검증을 한 번에. 쓸 수 없는 제목이면 `null`. */
export function parseTitle(raw: string): string | null {
  const title = normalizeTitle(raw);
  return title !== null && isValidTitle(title) ? title : null;
}

/** 제목 비교 키. 대소문자를 구분하지 않는다. */
export function titleKey(title: string): string {
  return title.toLowerCase();
}

/**
 * 치는 중인 검색어를 제목 키와 같은 꼴로 맞춘다. 제목처럼 NFC로 맞추고 공백·밑줄 묶음을 공백
 * 하나로 바꾸지만, 아직 다 치지 않은 글이라 앞뒤를 자르거나 검증하지 않는다.
 */
export function searchKey(query: string): string {
  return titleKey(query.normalize("NFC").replace(/[\s_]+/g, " "));
}

export function namespaceOf(title: string): Namespace {
  for (const [namespace, prefix] of Object.entries(NAMESPACE_PREFIX)) {
    if (title.startsWith(prefix)) return namespace as Namespace;
  }
  return "main";
}

/** 이름공간을 뗀 표시용 이름. `분류:생활` → `생활`. */
export function baseName(title: string): string {
  const namespace = namespaceOf(title);
  return namespace === "main"
    ? title
    : title.slice(NAMESPACE_PREFIX[namespace].length);
}

/**
 * 상위 문서 경로. `귀가/정기 귀가/신청`이면 `["귀가", "귀가/정기 귀가"]`.
 * 상위 문서가 실제로 있는지는 여기서 알 수 없다.
 */
export function ancestorTitles(title: string): string[] {
  const parts = title.split("/");
  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"));
}

/** 제목을 주소 경로로. 공백은 밑줄로 쓰고 `/`는 그대로 둔다. */
export function titleToPath(title: string): string {
  return title
    .split("/")
    .map((segment) => encodeURIComponent(segment.replaceAll(" ", "_")))
    .join("/");
}

/** 문서를 가리키는 앱 안의 주소. `action`은 `w`(보기), `edit`, `history`, `diff`, `move`, `discussion`. */
export function pageHref(
  title: string,
  action: "w" | "edit" | "history" | "diff" | "move" | "discussion" = "w",
): string {
  return `/${action}/${titleToPath(title)}`;
}

/** 넘겨주기를 따라가지 않고 넘겨주기 문서 자체를 여는 주소. */
export function redirectPageHref(title: string): string {
  return `${pageHref(title)}?redirect=no`;
}
