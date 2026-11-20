import type { AdminAction, AdminLogEntry, BanEntry } from "../model/log";
import type { RecentChange } from "~/features/pages";
import { getSupabase } from "~/shared/supabase/client";
import { unwrap, WikiError } from "~/shared/supabase/errors";

const PAGE_SIZE = 50;

/** `list_author_edits`의 `limit`과 같다. 한 쪽이 꽉 차면 더 볼 것이 있다. */
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
  // RPC는 행 하나를 돌려주거나 WK016으로 던진다. 타입을 좁히려고 같은 오류로 맞춘다.
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
 * 같은 사람의 다른 편집, 최신순 50개씩(관리자 전용). 유효한 조회 허가(`openAuthorLookup`)가
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
    byteSize: 0,
    byteDelta: row.byte_delta,
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

/** 관리자 목록(관리자 전용). 관리자 전용 이름만 온다. */
export async function listAdmins(): Promise<
  { handle: string; isMe: boolean }[]
> {
  const rows = unwrap(await getSupabase().rpc("list_admins"));
  return rows.map((row) => ({ handle: row.admin_handle, isMe: row.is_me }));
}

export async function getAdminCount(): Promise<number> {
  return unwrap(await getSupabase().rpc("admin_count")) ?? 0;
}
