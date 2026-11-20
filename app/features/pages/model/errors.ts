import { isWikiError } from "~/shared/supabase/errors";

/**
 * 쓰기 RPC의 오류 코드. DB 마이그레이션(`*_pages.sql`) 머리말의 표와 같다. WK015(넘겨주기 규칙)는
 * `*_redirect_rules.sql` 머리말에 있다.
 */
export const WRITE_ERROR = {
  conflict: "WK001",
  banned: "WK002",
  protected: "WK003",
  invalidTitle: "WK004",
  limit: "WK005",
  notFound: "WK006",
  unchanged: "WK007",
  deleted: "WK008",
  titleTaken: "WK009",
  invalidBody: "WK012",
  redirect: "WK015",
} as const;

const LIMIT_MESSAGE: Record<string, string> = {
  body: "문서가 너무 깁니다. 하위 문서로 나눠 주세요.",
  summary: "편집 요약은 200자까지 쓸 수 있습니다.",
  rate: "저장 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
};

const MESSAGE: Record<string, string> = {
  [WRITE_ERROR.conflict]:
    "편집하는 동안 다른 사람이 이 문서를 고쳤습니다. 아래에서 바뀐 내용을 확인해 주세요.",
  [WRITE_ERROR.banned]: "차단 기간에는 편집할 수 없습니다.",
  [WRITE_ERROR.protected]: "보호된 문서입니다. 관리자만 편집할 수 있습니다.",
  [WRITE_ERROR.invalidTitle]:
    "문서 제목에는 [ ] { } | # < > 문자를 사용할 수 없습니다.",
  [WRITE_ERROR.notFound]: "대상을 찾을 수 없습니다.",
  [WRITE_ERROR.unchanged]: "바뀐 내용이 없습니다.",
  [WRITE_ERROR.deleted]: "삭제된 문서입니다. 관리자에게 복구를 요청해 주세요.",
  [WRITE_ERROR.titleTaken]: "그 제목의 문서가 이미 있습니다.",
};

/** 넘겨주기 규칙(WK015)의 detail별 문구. 넘겨주기 입력이 저장 전에 같은 문구로 알린다. */
export const REDIRECT_MESSAGE: Record<string, string> = {
  content: "넘겨주기 문서에는 본문을 쓸 수 없습니다.",
  categories: "넘겨주기 문서에는 분류를 달 수 없습니다.",
  self: "같은 문서로 넘겨줄 수 없습니다.",
  // 저장할 때 DB가 넘겨주기를 끝까지 따라가 최종 문서로 바꾼다. 그러지 못할 때다.
  broken: "넘겨주기가 연결하는 문서가 없습니다. 다른 문서를 선택해 주세요.",
  loop: "넘겨주기가 순환합니다. 다른 문서를 선택해 주세요.",
  target: "연결할 문서 제목에는 [ ] { } | # < > 문자를 사용할 수 없습니다.",
};

const INVALID_BODY_MESSAGE: Record<string, string> = {
  link: "바깥 링크는 http://, https://, mailto: 주소만 걸 수 있습니다.",
};

/** 사용자에게 보여 줄 문구. 모르는 오류는 일반 문구로 답한다(내부 메시지를 그대로 보이지 않는다). */
export function describeWriteError(error: unknown): string {
  if (isWikiError(error)) {
    if (error.code === WRITE_ERROR.limit) {
      return LIMIT_MESSAGE[error.detail ?? ""] ?? LIMIT_MESSAGE.body!;
    }
    if (error.code === WRITE_ERROR.invalidBody) {
      return (
        INVALID_BODY_MESSAGE[error.detail ?? ""] ??
        "문서 형식이 올바르지 않아 저장하지 못했습니다. 새로 고친 뒤 다시 시도해 주세요."
      );
    }
    if (error.code === WRITE_ERROR.redirect) {
      return (
        REDIRECT_MESSAGE[error.detail ?? ""] ??
        "넘겨주기 문서로 저장할 수 없습니다."
      );
    }
    const message = MESSAGE[error.code];
    if (message) return message;
  }
  return "저장하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.";
}

/** 변화량을 `+120`, `-45`, `0`으로. */
export function formatByteDelta(delta: number): string {
  return delta > 0
    ? `+${delta.toLocaleString("ko")}`
    : delta.toLocaleString("ko");
}

const KIND_LABEL: Record<string, string> = {
  edit: "",
  revert: "되돌림",
  move: "이동",
  delete: "삭제",
  restore: "복구",
};

export function revisionKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? "";
}
