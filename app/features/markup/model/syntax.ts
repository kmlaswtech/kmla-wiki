/**
 * 위키 전용 문법의 정규식. 한곳에 모아 두어 "찾기"(refs)와 "바꾸기"(preprocess)가 같은 정의를 쓴다.
 * DB의 `private.extract_refs`에 같은 정규식이 있다.
 */

/** `[[문서]]`, `[[문서|표시]]`, `[[문서#문단]]`, `[[#문단]]`. 그룹: 대상, 문단, 표시. */
export const WIKI_LINK =
  /\[\[([^[\]|#\n]*)(?:#([^[\]|\n]*))?(?:\|([^[\]\n]*))?\]\]/g;

/** `{{틀:이름}}`, `{{틀:이름|값|값}}`. 그룹: 틀 제목, `|`로 시작하는 값 부분. */
export const TEMPLATE_CALL = /\{\{\s*(틀\s*:[^{}|\n]+)((?:\|[^{}]*)?)\}\}/g;

/** 틀 본문 안에서 값이 들어갈 자리. `{{{1}}}`. */
export const TEMPLATE_PARAMETER = /\{\{\{(\d+)\}\}\}/g;

/** `![설명](img:{uuid})`. 그룹: 이미지 id. */
export const UPLOADED_IMAGE =
  /!\[[^\]\n]*\]\(img:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

/** 본문 맨 앞의 `#넘겨주기 [[문서]]`. 그룹: 대상. */
export const REDIRECT = /^\s*#(?:넘겨주기|redirect)\s+\[\[([^[\]|#\n]+)/i;

/** `:::접기 제목` 줄. 그룹: 제목. */
export const FOLD_OPEN = /^(\s*):::\s*접기[ \t]*(.*)$/;

/** 내부 링크를 마크다운 링크로 바꿀 때 쓰는 주소 체계. 렌더러가 다시 알아본다. */
export const WIKI_SCHEME = "wiki:";
export const IMAGE_SCHEME = "img:";
