import { data } from "react-router";

import { parseTitle } from "~/features/markup";

export { positiveInt } from "~/shared/lib/query-param";

/**
 * 주소의 `*` 부분을 문서 제목으로 읽는다. 제목으로 쓸 수 없으면 404다.
 *
 * 주소에서는 공백을 밑줄로 쓴다. `parseTitle`이 밑줄을 공백으로 되돌린다.
 */
export function titleFromParams(params: { "*"?: string }): string {
  const title = parseTitle(params["*"] ?? "");
  if (!title) throw data(null, { status: 404 });
  return title;
}

/** 폼의 글자 값. 파일이거나 없으면 빈 문자열. */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** 0 이상의 정수 쿼리 값(문단 번호). 없거나 이상하면 `null`. */
export function nonNegativeInt(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}
