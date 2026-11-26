import { describeWriteError } from "~/features/pages";
import { isWikiError } from "~/shared/supabase/errors";

export type AdminAction =
  | "ban"
  | "lift_ban"
  | "grant_admin"
  | "revoke_admin"
  | "restore_admin"
  | "protect"
  | "unprotect"
  | "delete_page"
  | "restore_page"
  | "hide_revision"
  | "unhide_revision"
  | "view_author_edits"
  | "change_ban"
  | "bulk_revert"
  | "hide_discussion_post"
  | "unhide_discussion_post"
  | "delete_discussion"
  | "restore_discussion"
  | "close_discussion_early";

/** 공개 관리 기록의 한 줄. 누가 했는지는 관리자 이름(`관리자 B`)으로만 보인다. */
export interface AdminLogEntry {
  id: number;
  action: AdminAction;
  pageTitle: string | null;
  revisionId: number | null;
  /** 근거가 된 판의 가명(그 문서에서의). */
  pseudonym: string | null;
  reason: string;
  note: string | null;
  /** 대상 토론(토론 동작). */
  discussionId: number | null;
  /** 조치한 관리자의 이름. 이름을 공개하기 전의 기록은 `null`이다. */
  actorHandle: string | null;
  /** 관리자 지정·해제·되돌림의 대상 관리자 이름. 이름을 공개하기 전의 기록은 `null`이다. */
  targetHandle: string | null;
  createdAt: string;
}

/** 되돌릴 수 있는 관리자 해제. `logId`는 해제의 공개 기록 ID다. */
export interface RestorableRevocation {
  logId: number;
  handle: string;
  reason: string;
  restorableUntil: string;
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
 * 이름 끝소리에 받침이 있는가(조사 고르기). 관리자 이름은 `관리자 B`, `관리자 27`처럼 영문자나 숫자로
 * 끝난다. 영문자는 읽는 소리로 본다(엘·엠·엔·알만 받침). 숫자는 끝 자리로 보고, 0은 십·백처럼 받침이 있다.
 */
function endsWithFinal(name: string): boolean {
  const last = name.at(-1) ?? "";
  if (/[a-z]/i.test(last)) return /[lmnr]/i.test(last);
  if (/\d/.test(last)) return "013678".includes(last);
  const code = last.charCodeAt(0) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0;
}

/** 이름에 조사를 붙인다. `withFinal`은 받침 뒤(이·을), `withoutFinal`은 받침 없을 때(가·를). */
export function withParticle(
  name: string,
  withFinal: string,
  withoutFinal: string,
): string {
  return name + (endsWithFinal(name) ? withFinal : withoutFinal);
}

/**
 * 기록을 한 문장으로. 행위자(`관리자 A가`)는 화면이 앞에 붙인다. 대상은 "가명 (문서)"로 적는다. 가명은 그 문서 안에서만 뜻이 있어서 문서
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
      return `${who} 편집 차단${note}`;
    case "lift_ban":
      return `${who} 차단 해제`;
    case "change_ban":
      return `${who} 차단 기간 변경${note}`;
    // 대상은 관리자 이름으로만 적는다. 근거 판의 가명은 남기지 않는다.
    case "grant_admin":
      return entry.targetHandle
        ? `${withParticle(entry.targetHandle, "을", "를")} 관리자로 지정`
        : "관리자 1명 지정";
    case "revoke_admin":
      return entry.targetHandle
        ? `${entry.targetHandle}의 관리자 권한 해제`
        : "관리자 권한 1건 해제";
    case "restore_admin":
      return entry.targetHandle
        ? `${entry.targetHandle}의 관리자 권한 해제 되돌림${note}`
        : `관리자 권한 해제 되돌림${note}`;
    case "protect":
      return `‘${page}’ 문서 보호`;
    case "unprotect":
      return `‘${page}’ 문서 보호 해제`;
    case "delete_page":
      return `‘${page}’ 문서 삭제`;
    case "restore_page":
      return `‘${page}’ 문서 복구`;
    case "hide_revision":
      return `‘${page}’ r${entry.revisionId} 숨김`;
    case "unhide_revision":
      return `‘${page}’ r${entry.revisionId} 숨김 해제`;
    case "view_author_edits":
      return `${who}의 다른 편집 조회`;
    case "bulk_revert":
      return `${who}의 편집 일괄 되돌림${note}`;
    // 토론은 번호로만 적는다. 토론 제목은 지우거나 숨길 대상일 수 있어서 기록에 남기지 않는다.
    case "hide_discussion_post":
      return `‘${page}’ 토론 #${entry.discussionId}에서 ${entry.pseudonym ?? ""}의 글 숨김`;
    case "unhide_discussion_post":
      return `‘${page}’ 토론 #${entry.discussionId}에서 ${entry.pseudonym ?? ""}의 글 숨김 해제`;
    case "delete_discussion":
      return `‘${page}’ 토론 #${entry.discussionId} 지움`;
    case "restore_discussion":
      return `‘${page}’ 토론 #${entry.discussionId} 되살림`;
    case "close_discussion_early":
      return `‘${page}’ 토론 #${entry.discussionId} 24시간 전에 닫음`;
  }
}

// DB 마이그레이션(`*_admin.sql`, `*_admin_lookups_ban_end.sql`, `*_admin_bulk_revert_reports.sql`,
// `*_restore_revoked_admin.sql`, `*_admin_nickname.sql`)
// 머리말의 표와 같다.
const MESSAGE: Record<string, string> = {
  "42501": "관리자 권한이 필요합니다.",
  WK002: "차단된 회원은 관리자로 지정하거나 되돌릴 수 없습니다.",
  WK010: "관리자를 차단하려면 먼저 관리자 권한을 해제해 주세요.",
  WK011: "이미 처리된 상태입니다.",
  WK012: "현재 판은 숨길 수 없습니다. [되돌리고 숨기기]를 써 주세요.",
  WK013: "마지막 관리자의 권한은 해제할 수 없습니다.",
  WK014: "사유를 2자 이상 적어 주세요.",
  WK016: "조회 시간이 만료되었습니다. 사유를 입력한 뒤 다시 조회해 주세요.",
  WK017: "차단 기간은 1시간부터 10년까지 정할 수 있습니다.",
  WK018: "일괄 되돌리기는 한 번에 200개 문서까지 할 수 있습니다.",
  WK020:
    "해제한 지 7일이 지나 되돌릴 수 없습니다. 판 기록에서 다시 지정해 주세요.",
  WK021:
    "별명은 20자까지 쓸 수 있습니다. 줄바꿈, 보이지 않는 문자, ‘관리자’로 시작하는 별명은 쓸 수 없습니다.",
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
