import { describeWriteError } from "~/features/pages";
import { isWikiError } from "~/shared/supabase/errors";

export type AdminAction =
  | "ban"
  | "lift_ban"
  | "grant_admin"
  | "revoke_admin"
  | "protect"
  | "unprotect"
  | "delete_page"
  | "restore_page"
  | "hide_revision"
  | "unhide_revision"
  | "view_author_edits"
  | "change_ban";

/** 공개 관리 기록의 한 줄. 누가 했는지는 없다("관리자"로만 보인다). */
export interface AdminLogEntry {
  id: number;
  action: AdminAction;
  pageTitle: string | null;
  revisionId: number | null;
  /** 근거가 된 판의 가명(그 문서에서의). */
  pseudonym: string | null;
  reason: string;
  note: string | null;
  createdAt: string;
}

export interface BanEntry {
  id: number;
  pseudonym: string;
  pageTitle: string;
  revisionId: number | null;
  startsAt: string;
  /** `null`이면 기한 없음. */
  endsAt: string | null;
  reason: string;
  liftedAt: string | null;
}

/** 차단이 지금도 유효한가. */
export function isBanActive(ban: BanEntry, now: number): boolean {
  if (ban.liftedAt) return false;
  return ban.endsAt === null || new Date(ban.endsAt).getTime() > now;
}

/**
 * 기록을 한 문장으로. 대상은 "가명 (문서)"로 적는다. 가명은 그 문서 안에서만 뜻이 있어서 문서
 * 이름을 함께 보여야 한다.
 */
export function describeAdminLog(entry: AdminLogEntry): string {
  const who =
    entry.pseudonym && entry.pageTitle
      ? `${entry.pseudonym} (${entry.pageTitle})`
      : "";
  const page = entry.pageTitle ?? "";
  const note = entry.note ? ` (${entry.note})` : "";

  switch (entry.action) {
    case "ban":
      return `관리자가 ${who}의 편집을 차단함${note}`;
    case "lift_ban":
      return `관리자가 ${who}의 차단을 해제함`;
    case "change_ban":
      return `관리자가 ${who}의 차단 기간을 바꿈${note}`;
    case "grant_admin":
      return "관리자가 관리자 1명을 지정함";
    case "revoke_admin":
      return "관리자가 관리자 1명을 해제함";
    case "protect":
      return `관리자가 ${page} 문서를 보호함`;
    case "unprotect":
      return `관리자가 ${page} 문서의 보호를 해제함`;
    case "delete_page":
      return `관리자가 ${page} 문서를 삭제함`;
    case "restore_page":
      return `관리자가 ${page} 문서를 복구함`;
    case "hide_revision":
      return `관리자가 ${page} 문서의 판(r${entry.revisionId})을 숨김`;
    case "unhide_revision":
      return `관리자가 ${page} 문서의 판(r${entry.revisionId}) 숨김을 해제함`;
    case "view_author_edits":
      return `관리자가 ${who}의 다른 편집을 조회함`;
  }
}

// DB 마이그레이션(`*_admin.sql`, `*_admin_lookups_ban_end.sql`) 머리말의 표와 같다.
const MESSAGE: Record<string, string> = {
  "42501": "관리자만 할 수 있습니다.",
  "22023": "기간이 올바르지 않습니다. 5분 뒤부터 10년 안으로 정해 주세요.",
  WK010: "관리자는 차단할 수 없습니다. 먼저 관리자에서 해제해 주세요.",
  WK011: "이미 처리된 상태입니다.",
  WK012: "현재 판은 숨길 수 없습니다. 먼저 이전 판으로 되돌려 주세요.",
  WK013: "마지막 관리자는 해제할 수 없습니다.",
  WK014: "사유를 2자 이상 적어 주세요.",
  WK016: "조회 허가가 끝났습니다. 사유를 적고 다시 조회해 주세요.",
};

/** 같은 사람의 다른 편집을 보는 허가가 없거나 끝났다. */
export function isLookupExpired(error: unknown): boolean {
  return isWikiError(error, "WK016");
}

export function describeAdminError(error: unknown): string {
  if (isWikiError(error)) {
    const message = MESSAGE[error.code];
    if (message) return message;
  }
  return describeWriteError(error);
}
