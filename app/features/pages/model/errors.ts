import { isWikiError } from "~/shared/supabase/errors";

/**
 * 쓰기 RPC의 오류 코드. DB 마이그레이션(`*_pages.sql`) 머리말의 표와 같다.
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
} as const;

const LIMIT_MESSAGE: Record<string, string> = {
  body: "문서가 너무 깁니다. 하위 문서로 나눠 주세요.",
  summary: "편집 요약은 200자까지 쓸 수 있습니다.",
  rate: "짧은 시간에 너무 많이 저장했습니다. 잠시 뒤에 다시 시도해 주세요.",
};

const MESSAGE: Record<string, string> = {
  [WRITE_ERROR.conflict]:
    "편집하는 동안 다른 사람이 이 문서를 고쳤습니다. 아래에서 바뀐 내용을 확인해 주세요.",
  [WRITE_ERROR.banned]: "차단 기간에는 편집할 수 없습니다.",
  [WRITE_ERROR.protected]: "보호된 문서라 관리자만 편집할 수 있습니다.",
  [WRITE_ERROR.invalidTitle]:
    "쓸 수 없는 제목입니다. [ ] { } | # < > 는 제목에 쓸 수 없습니다.",
  [WRITE_ERROR.notFound]: "대상을 찾을 수 없습니다.",
  [WRITE_ERROR.unchanged]: "바뀐 내용이 없습니다.",
  [WRITE_ERROR.deleted]:
    "삭제된 문서입니다. 다시 만들려면 관리자에게 복구를 요청해 주세요.",
  [WRITE_ERROR.titleTaken]: "그 제목의 문서가 이미 있습니다.",
};

/** 사용자에게 보여 줄 문구. 모르는 오류는 일반 문구로 답한다(내부 메시지를 그대로 보이지 않는다). */
export function describeWriteError(error: unknown): string {
  if (isWikiError(error)) {
    if (error.code === WRITE_ERROR.limit) {
      return LIMIT_MESSAGE[error.detail ?? ""] ?? LIMIT_MESSAGE.body!;
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
