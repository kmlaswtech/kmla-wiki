/**
 * DB가 돌려준 오류를 앱이 다루는 모양으로 바꾼다.
 *
 * RPC는 실패 사유를 SQLSTATE로 알린다(`supabase/migrations/*_pages.sql` 머리말의 표). 화면은 문구를
 * 정하기 위해 그 코드만 본다. 오류 메시지 문자열에는 기대지 않는다.
 */
export class WikiError extends Error {
  readonly code: string;
  /** 같은 코드 안에서 세부 사유를 가르는 값(예: 상한 초과의 `body`/`summary`/`rate`). */
  readonly detail: string | null;

  constructor(code: string, message: string, detail: string | null = null) {
    super(message);
    this.name = "WikiError";
    this.code = code;
    this.detail = detail;
  }
}

/** 회원 확인이 없거나 지났다. 로그인 화면으로 보내야 한다. */
export const NOT_VERIFIED = "42501";

interface PostgrestLikeError {
  code?: string;
  message: string;
  details?: string | null;
}

export function toWikiError(error: PostgrestLikeError): WikiError {
  return new WikiError(
    error.code ?? "unknown",
    error.message,
    error.details ?? null,
  );
}

/** `{ data, error }` 응답에서 오류를 던지고 데이터만 남긴다. */
export function unwrap<T>(result: {
  data: T | null;
  error: PostgrestLikeError | null;
}): T {
  if (result.error) throw toWikiError(result.error);
  return result.data as T;
}

export function isWikiError(error: unknown, code?: string): error is WikiError {
  return (
    error instanceof WikiError && (code === undefined || error.code === code)
  );
}
