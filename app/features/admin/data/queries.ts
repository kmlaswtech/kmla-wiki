import type { BulkRevertRow, BulkRevertStatus } from "../model/bulk-revert";
import type {
  AdminAction,
  AdminLogEntry,
  BanEntry,
  RestorableRevocation,
} from "../model/log";
import type { RecentChange } from "~/features/pages";
import { getSupabase } from "~/shared/supabase/client";
import { unwrap, WikiError } from "~/shared/supabase/errors";

const PAGE_SIZE = 50;

/** 다른 편집 목록의 한 쪽. 클라이언트가 늘 `p_limit`으로 보낸다. 한 쪽이 꽉 차면 더 볼 것이 있다. */
export const AUTHOR_EDITS_PAGE_SIZE = 50;

/** 공개 관리 기록, 최신순. 승인 회원 누구나 읽는다. */
export async function listAdminLog(before?: number): Promise<AdminLogEntry[]> {
  let query = getSupabase()
    .from("admin_log")
    .select(
      "id, action, page_title, revision_id, pseudonym, reason, note, created_at",
    )
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);
  if (before !== undefined) query = query.lt("id", before);

  return unwrap(await query).map((row) => ({
    id: row.id,
    action: row.action as AdminAction,
    pageTitle: row.page_title,
    revisionId: row.revision_id,
    pseudonym: row.pseudonym,
    reason: row.reason,
    note: row.note,
    createdAt: row.created_at,
  }));
}

/** 공개 차단 내역, 최신순. */
export async function listBans(): Promise<BanEntry[]> {
  const rows = unwrap(
    await getSupabase()
      .from("ban_log")
      .select(
        "id, pseudonym, page_title, revision_id, starts_at, ends_at, reason, lifted_at",
      )
      .order("id", { ascending: false })
      .limit(200),
  );
  return rows.map((row) => ({
    id: row.id,
    pseudonym: row.pseudonym,
    pageTitle: row.page_title,
    revisionId: row.revision_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
    liftedAt: row.lifted_at,
  }));
}

export interface AuthorEdit extends RecentChange {
  pageId: number;
  isCurrent: boolean;
  pageDeleted: boolean;
}

/** 허가의 근거 판. "이 사람에 대한 조치" 메뉴의 대상이다. */
export interface LookupSource {
  id: number;
  pageTitle: string;
  authorPseudonym: string;
  hiddenAt: string | null;
  isCurrent: boolean;
}

/** 조회 허가의 근거 판과 끝나는 시각. 허가가 없거나 끝났으면 `WK016`으로 던진다. */
export async function getAuthorLookup(
  lookupId: string,
): Promise<{ source: LookupSource; expiresAt: string }> {
  const [row] = unwrap(
    await getSupabase().rpc("get_author_lookup", { p_lookup_id: lookupId }),
  );
  // RPC는 행 하나를 돌려주거나 WK016으로 던진다. 생성 타입이 배열이라 타입을 좁히려고 같은 오류로 맞춘다.
  if (!row) throw new WikiError("WK016", "lookup expired");
  return {
    source: {
      id: row.source_revision_id,
      pageTitle: row.page_title,
      authorPseudonym: row.pseudonym,
      hiddenAt: row.hidden_at,
      isCurrent: row.is_current,
    },
    expiresAt: row.expires_at,
  };
}

/**
 * 같은 사람의 다른 편집, 최신순으로 `limit`개(관리자 전용). 유효한 조회 허가(`openAuthorLookup`)가
 * 있어야 하고, 허가가 끝났으면 `WK016`으로 던진다.
 */
export async function listAuthorEdits(
  lookupId: string,
  before?: number,
  limit: number = AUTHOR_EDITS_PAGE_SIZE,
): Promise<AuthorEdit[]> {
  const rows = unwrap(
    await getSupabase().rpc("list_author_edits", {
      p_lookup_id: lookupId,
      p_before_revision_id: before,
      p_limit: limit,
    }),
  );
  return rows.map((row) => ({
    id: row.revision_id,
    parentRevisionId: row.parent_revision_id,
    kind: row.kind as AuthorEdit["kind"],
    summary: row.summary,
    authorPseudonym: row.pseudonym,
    textAdded: row.text_added,
    textRemoved: row.text_removed,
    createdAt: row.created_at,
    hiddenAt: row.hidden_at,
    pageId: row.page_id,
    pageTitle: row.page_title,
    isCurrent: row.is_current,
    pageDeleted: row.page_deleted,
  }));
}

/**
 * 이 판을 쓴 사람에 대해 내가 연, 다시 쓸 수 있는(2분 넘게 남은) 조회 허가. 없으면 `null`. 이미
 * 사유를 적고 연 허가로 돌아가는 길이라 기록을 남기지 않는다.
 */
export async function findAuthorLookup(
  revisionId: number,
): Promise<string | null> {
  return unwrap(
    await getSupabase().rpc("find_author_lookup", {
      p_revision_id: revisionId,
    }),
  );
}

export interface OpenLookup {
  id: string;
  sourceRevisionId: number;
  /** 허가를 열 때 근거가 된 판의 문서와 가명(공개 기록과 같다). */
  pageTitle: string | null;
  pseudonym: string | null;
  expiresAt: string;
}

/** 내가 연, 아직 유효한 조회 허가. 끝나는 때가 늦은 순. */
export async function listMyAuthorLookups(): Promise<OpenLookup[]> {
  const rows = unwrap(await getSupabase().rpc("list_my_author_lookups"));
  return rows.map((row) => ({
    id: row.lookup_id,
    sourceRevisionId: row.source_revision_id,
    pageTitle: row.page_title,
    pseudonym: row.pseudonym,
    expiresAt: row.expires_at,
  }));
}

/** 미리보기가 한 번에 돌려주는 문서 수. 서버(`preview_bulk_revert`)와 같다. 꽉 차면 더 있을 수 있다. */
export const BULK_REVERT_PREVIEW_LIMIT = 500;

/**
 * 일괄 되돌리기 미리보기(관리자 전용, 기록 없음). `fromRevisionId`부터 대상이 쓴 판을 문서마다
 * 어떻게 걷어 낼지. 없으면 대상의 모든 편집이다. 허가가 끝났으면 `WK016`으로 던진다.
 */
export async function previewBulkRevert(
  lookupId: string,
  fromRevisionId: number | null,
): Promise<BulkRevertRow[]> {
  const rows = unwrap(
    await getSupabase().rpc("preview_bulk_revert", {
      p_lookup_id: lookupId,
      p_from_revision_id: fromRevisionId ?? undefined,
    }),
  );
  return rows.map((row) => ({
    pageId: row.page_id,
    pageTitle: row.page_title,
    currentRevisionId: row.current_revision_id,
    restoreRevisionId: row.restore_revision_id,
    editCount: row.edit_count,
    keptCount: row.kept_count,
    hasMove: row.has_move,
    moveLeftover: row.move_leftover,
    status: row.status as BulkRevertStatus,
  }));
}

/** 신고 한 건. 신고자는 오지 않는다. */
export interface ReportNote {
  category: string;
  note: string;
  createdAt: string;
}

/** 처리되지 않은 신고를 판별로 묶은 것. */
export interface OpenReport {
  revisionId: number;
  pageId: number;
  pageTitle: string;
  authorPseudonym: string;
  parentRevisionId: number | null;
  revisionCreatedAt: string;
  hiddenAt: string | null;
  isCurrent: boolean;
  pageDeleted: boolean;
  reports: ReportNote[];
  /** 같은 판에서 전에 기각한 신고 수. */
  dismissedCount: number;
}

/** 처리되지 않은 신고, 오래된 것부터(관리자 전용). */
export async function listOpenReports(): Promise<OpenReport[]> {
  const rows = unwrap(await getSupabase().rpc("list_open_reports"));
  return rows.map((row) => ({
    revisionId: row.revision_id,
    pageId: row.page_id,
    pageTitle: row.page_title,
    authorPseudonym: row.pseudonym,
    parentRevisionId: row.parent_revision_id,
    revisionCreatedAt: row.revision_created_at,
    hiddenAt: row.hidden_at,
    isCurrent: row.is_current,
    pageDeleted: row.page_deleted,
    reports: (
      row.reports as { category: string; note: string; created_at: string }[]
    ).map((report) => ({
      category: report.category,
      note: report.note,
      createdAt: report.created_at,
    })),
    dismissedCount: row.dismissed_count,
  }));
}

/** 처리되지 않은 신고가 걸린 판 수(관리자 전용). */
export async function countOpenReports(): Promise<number> {
  return unwrap(await getSupabase().rpc("count_open_reports")) ?? 0;
}

/** 관리자 목록(관리자 전용). 관리자 전용 이름만 온다. */
export async function listAdmins(): Promise<
  { handle: string; nickname: string | null; isMe: boolean }[]
> {
  const rows = unwrap(await getSupabase().rpc("list_admins"));
  return rows.map((row) => ({
    handle: row.admin_handle,
    nickname: row.admin_nickname,
    isMe: row.is_me,
  }));
}

/** 되돌릴 수 있는 관리자 해제(관리자 전용). 해제된 사람은 관리자 전용 이름으로만 온다. */
export async function listRestorableRevocations(): Promise<
  RestorableRevocation[]
> {
  const rows = unwrap(await getSupabase().rpc("list_restorable_revocations"));
  return rows.map((row) => ({
    logId: row.admin_log_id,
    handle: row.admin_handle,
    reason: row.reason,
    restorableUntil: row.restorable_until,
  }));
}

export async function getAdminCount(): Promise<number> {
  return unwrap(await getSupabase().rpc("admin_count")) ?? 0;
}
