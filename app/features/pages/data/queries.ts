import type {
  Backlink,
  PageView,
  RecentChange,
  RedirectInfo,
  ResolvedBody,
  RevisionBody,
  RevisionSummary,
  SearchHit,
  TitleInfo,
} from "../model/types";
import { headingTargets, type HeadingTarget } from "../model/headings";
import { titleMatchPattern } from "../model/hangul-match";
import { SPECIAL_PAGE_SIZE } from "../model/special";
import {
  asWikiDoc,
  parseTitle,
  searchKey,
  titleKey,
  type Namespace,
  type WikiDoc,
} from "~/features/markup";
import { toImageMap, type RawImage } from "~/features/images";
import { getSupabase } from "~/shared/supabase/client";
import type { Json } from "~/shared/supabase/database.types";
import { unwrap } from "~/shared/supabase/errors";

// RPC가 jsonb로 돌려주는 모양. DB의 `get_page_view` · `resolve_body`와 맞춘다.
interface RawResolved {
  templates: { title: string; body: unknown }[];
  existing: string[];
}

interface RawBacklink {
  title: string;
  is_redirect: boolean;
}

interface RawPageView {
  found: boolean;
  title: string | null;
  valid_title?: boolean;
  can_edit: boolean;
  is_admin: boolean;
  redirected_from?: string | null;
  redirect?: {
    target: string;
    state: RedirectInfo["state"];
    next: string | null;
  } | null;
  page?: {
    id: number;
    title: string;
    namespace: Namespace;
    protection: "open" | "admin";
    redirect_target: string | null;
    current_revision_id: number | null;
    updated_at: string;
    deleted_at: string | null;
  };
  revision?: {
    id: number;
    body: unknown;
    created_at: string;
    is_current: boolean;
  } | null;
  resolved?: RawResolved;
  images?: RawImage[];
  backlinks: RawBacklink[];
  children?: string[];
  members?: string[];
}

function toResolved(raw: RawResolved): ResolvedBody {
  return {
    templates: new Map(
      raw.templates.map((template) => [
        titleKey(template.title),
        asWikiDoc(template.body),
      ]),
    ),
    existing: new Set(raw.existing),
  };
}

function toBacklinks(raw: RawBacklink[]): Backlink[] {
  return raw.map((link) => ({
    title: link.title,
    isRedirect: link.is_redirect,
  }));
}

/**
 * 문서 보기 화면에 필요한 전부를 한 번에 읽는다.
 *
 * @param followRedirect 넘겨주기 문서면 대상을 보여 줄지. 넘겨주기 문서 자체를 고칠 때는 끈다.
 * @param revisionId 예전 판을 볼 때.
 */
export async function getPageView(
  title: string,
  {
    followRedirect = true,
    revisionId,
  }: { followRedirect?: boolean; revisionId?: number } = {},
): Promise<PageView> {
  const raw = unwrap(
    await getSupabase().rpc("get_page_view", {
      p_title: title,
      p_follow_redirect: followRedirect,
      p_revision_id: revisionId,
    }),
  ) as unknown as RawPageView;

  const viewer = { canEdit: raw.can_edit, isAdmin: raw.is_admin };

  if (!raw.found || !raw.page || !raw.resolved) {
    return {
      found: false,
      title: raw.title,
      validTitle: raw.valid_title ?? false,
      backlinks: toBacklinks(raw.backlinks),
      ...viewer,
    };
  }

  const backlinks = toBacklinks(raw.backlinks);
  // 넘겨주기 문서로 오는 넘겨주기는 이중 넘겨주기다. 다른 이름으로 치지 않고 역링크에 남긴다.
  const isAlias = (link: Backlink) => !raw.redirect && link.isRedirect;

  return {
    found: true,
    page: {
      id: raw.page.id,
      title: raw.page.title,
      namespace: raw.page.namespace,
      protection: raw.page.protection,
      redirectTarget: raw.page.redirect_target,
      currentRevisionId: raw.page.current_revision_id,
      updatedAt: raw.page.updated_at,
      deletedAt: raw.page.deleted_at,
    },
    redirectedFrom: raw.redirected_from ?? null,
    redirect: raw.redirect
      ? {
          target: raw.redirect.target,
          state: raw.redirect.state,
          next: raw.redirect.next ?? null,
        }
      : null,
    revision: raw.revision
      ? {
          id: raw.revision.id,
          body: asWikiDoc(raw.revision.body),
          createdAt: raw.revision.created_at,
          isCurrent: raw.revision.is_current,
        }
      : null,
    resolved: toResolved(raw.resolved),
    images: toImageMap(raw.images ?? []),
    aliases: backlinks.filter(isAlias).map((link) => link.title),
    backlinks: backlinks.filter((link) => !isAlias(link)),
    children: raw.children ?? [],
    members: raw.members ?? [],
    ...viewer,
  };
}

/** 아직 저장하지 않은 본문을 그리는 데 필요한 것(편집 미리보기). */
export async function resolveBody(body: WikiDoc): Promise<ResolvedBody> {
  const raw = unwrap(
    await getSupabase().rpc("resolve_body", {
      p_body: body as unknown as Json,
    }),
  );
  return toResolved(raw as unknown as RawResolved);
}

// 목록에는 본문을 싣지 않는다. 판마다 본문 전체가 들어 있어 목록에서 읽으면 전송량이 커진다.
const SUMMARY_COLUMNS =
  "id, parent_revision_id, kind, summary, author_pseudonym, text_added, text_removed, created_at, hidden_at";

interface RawRevision {
  id: number;
  parent_revision_id: number | null;
  kind: string;
  summary: string;
  author_pseudonym: string;
  text_added: number;
  text_removed: number;
  created_at: string;
  hidden_at: string | null;
}

function toSummary(row: RawRevision): RevisionSummary {
  return {
    id: row.id,
    parentRevisionId: row.parent_revision_id,
    kind: row.kind as RevisionSummary["kind"],
    summary: row.summary,
    authorPseudonym: row.author_pseudonym,
    textAdded: row.text_added,
    textRemoved: row.text_removed,
    createdAt: row.created_at,
    hiddenAt: row.hidden_at,
  };
}

export const HISTORY_PAGE_SIZE = 50;

/** 문서의 판 기록, 최신순. `before`보다 오래된 판부터 이어서 읽는다. */
export async function listHistory(
  pageId: number,
  before?: number,
): Promise<RevisionSummary[]> {
  let query = getSupabase()
    .from("revisions")
    .select(SUMMARY_COLUMNS)
    .eq("page_id", pageId)
    .order("id", { ascending: false })
    .limit(HISTORY_PAGE_SIZE);
  if (before !== undefined) query = query.lt("id", before);

  return unwrap(await query).map(toSummary);
}

/** 모든 문서의 최근 변경, 최신순. */
export async function listRecentChanges(
  before?: number,
): Promise<RecentChange[]> {
  let query = getSupabase()
    .from("revisions")
    // pages와 revisions 사이에 외래 키가 둘이라(page_id, current_revision_id) 어느 쪽인지 적는다.
    .select(`${SUMMARY_COLUMNS}, page:pages!revisions_page_id_fkey(title)`)
    .order("id", { ascending: false })
    .limit(HISTORY_PAGE_SIZE);
  if (before !== undefined) query = query.lt("id", before);

  return unwrap(await query).map((row) => ({
    ...toSummary(row),
    pageTitle: row.page.title,
  }));
}

/**
 * 가장 최근에 바뀐 문서 `limit`개와 그 현재 판, 최신순. 문서마다 한 줄이다(곁의 최근 변경 목록).
 *
 * 판 id는 늘기만 하므로 현재 판 id 순서가 곧 마지막으로 바뀐 순서다. 볼 수 없는 판(숨긴 판)은
 * 빠진다.
 */
export async function listRecentlyChangedPages(
  limit: number,
): Promise<RecentChange[]> {
  const rows = unwrap(
    await getSupabase()
      .from("pages")
      .select(
        `title, revision:revisions!pages_current_revision_fkey(${SUMMARY_COLUMNS})`,
      )
      .not("current_revision_id", "is", null)
      .order("current_revision_id", { ascending: false })
      .limit(limit),
  );
  return rows.flatMap((row) =>
    row.revision ? [{ ...toSummary(row.revision), pageTitle: row.title }] : [],
  );
}

/** 판 비교용. 요청한 판 가운데 볼 수 있는 것만 돌려준다. */
export async function getRevisionBodies(
  pageId: number,
  revisionIds: readonly number[],
): Promise<RevisionBody[]> {
  const rows = unwrap(
    await getSupabase()
      .from("revisions")
      .select(`${SUMMARY_COLUMNS}, body`)
      .eq("page_id", pageId)
      .in("id", [...revisionIds]),
  );
  return rows.map((row) => ({ ...toSummary(row), body: asWikiDoc(row.body) }));
}

/** 판 기록에서 내가 쓴 판을 표시하기 위한, 이 문서에서의 내 가명. 편집한 적이 없으면 `null`. */
export async function getMyPseudonym(pageId: number): Promise<string | null> {
  return unwrap(await getSupabase().rpc("my_pseudonym", { p_page_id: pageId }));
}

export async function searchPages(query: string): Promise<SearchHit[]> {
  if (query.trim() === "") return [];
  const rows = unwrap(
    await getSupabase().rpc("search_pages", { p_query: query }),
  );
  return rows.map((row) => ({
    title: row.title,
    matchedRedirect: row.matched_redirect,
    snippet: row.snippet,
  }));
}

/**
 * 검색어와 제목이 정확히 같은(대소문자 무시) 문서의 제목. 없으면 `null`.
 *
 * 머리띠 검색에서 Enter를 쳤을 때 결과 목록 대신 그 문서로 바로 보내는 데 쓴다. 넘겨주기 문서도
 * 잡히고, 넘겨주기는 문서 보기가 따라간다.
 */
export async function findExactTitle(query: string): Promise<string | null> {
  return (await getTitleInfo(query))?.title ?? null;
}

/** 그 제목의 문서가 있는지, 넘겨주기인지. 없거나 쓸 수 없는 제목이면 `null`. */
export async function getTitleInfo(query: string): Promise<TitleInfo | null> {
  const title = parseTitle(query);
  if (!title) return null;
  const rows = unwrap(
    await getSupabase()
      .from("pages")
      .select("title, redirect_target")
      .is("deleted_at", null)
      .eq("title_key", titleKey(title))
      .limit(1),
  );
  const row = rows[0];
  return row ? { title: row.title, redirectTarget: row.redirect_target } : null;
}

/**
 * 넘겨주기를 끝까지 따라간 결과. `via`는 처음 만난 넘겨주기 문서다(쓴 이름이 넘겨주기가 아니면
 * `null`). 없는 문서에 닿으면 `missing`, 돌고 돌면 `loop`, `stopTitle` 문서에 닿으면 `stop`이다.
 */
export type RedirectResolution =
  | { status: "page"; title: string; via: string | null }
  | { status: "missing" | "loop" | "stop"; via: string | null };

/**
 * 넘겨주기를 끝까지 따라가 최종 문서를 찾는다(`resolve_redirect`). 넘겨주기 문서를 저장하기 전에
 * 확인할 때는 그 문서 이름을 `stopTitle`로 준다. 저장(`save_revision`)과 같은 판정이 나온다.
 */
export async function resolveRedirect(
  title: string,
  stopTitle?: string,
): Promise<RedirectResolution> {
  const rows = unwrap(
    await getSupabase().rpc("resolve_redirect", {
      p_title: title,
      ...(stopTitle === undefined ? {} : { p_stop_key: titleKey(stopTitle) }),
    }),
  );
  const row = rows[0];
  // 생성 타입은 열이 null일 수 있음을 모른다.
  const via = (row?.via as string | null | undefined) ?? null;
  const final = row?.title as string | null | undefined;
  if (row?.status === "page" && final) {
    return { status: "page", title: final, via };
  }
  const status =
    row?.status === "loop" || row?.status === "stop" ? row.status : "missing";
  return { status, via };
}

/** 링크는 걸려 있는데 아직 없는 문서. 많이 가리켜진 순. 영문 제목은 소문자로 온다. */
export async function listWantedPages(): Promise<
  { title: string; refCount: number }[]
> {
  const rows = unwrap(await getSupabase().rpc("wanted_pages"));
  return rows.map((row) => ({ title: row.title_key, refCount: row.ref_count }));
}

/** 어디서도 링크하지 않는 일반 문서. `after` 제목 다음부터. */
export async function listOrphanPages(after?: string): Promise<string[]> {
  const rows = unwrap(
    await getSupabase().rpc("orphan_pages", {
      p_after: after,
      p_limit: SPECIAL_PAGE_SIZE,
    }),
  );
  return rows.map((row) => row.title);
}

/** 이름공간의 모든 문서, 가나다순. `after` 제목 다음부터. */
export async function listAllPages(
  namespace: Namespace = "main",
  after?: string,
): Promise<string[]> {
  const rows = unwrap(
    await getSupabase().rpc("list_all_pages", {
      p_namespace: namespace,
      p_after: after,
      p_limit: SPECIAL_PAGE_SIZE,
    }),
  );
  return rows.map((row) => row.title);
}

/**
 * 이름공간의 문서를 현재 판 크기 순으로. `longest`면 긴 문서부터, 아니면 짧은 문서부터다.
 * `offset`개를 건너뛴 다음부터 준다.
 */
export async function listPagesBySize(
  namespace: Namespace,
  longest: boolean,
  offset = 0,
): Promise<{ title: string; textSize: number }[]> {
  const rows = unwrap(
    await getSupabase().rpc("page_sizes", {
      p_namespace: namespace,
      p_longest: longest,
      p_offset: offset,
      p_limit: SPECIAL_PAGE_SIZE,
    }),
  );
  return rows.map((row) => ({ title: row.title, textSize: row.text_size }));
}

/** 손볼 넘겨주기. `next`가 `null`이면 대상이 없거나 삭제됐고, 있으면 대상도 넘겨주기다. */
export async function listRedirectIssues(): Promise<
  { title: string; target: string; next: string | null }[]
> {
  // 생성 타입은 `next`를 null 없이 적지만 대상이 없으면 null이 온다.
  return unwrap(await getSupabase().rpc("redirect_issues")) as {
    title: string;
    target: string;
    next: string | null;
  }[];
}

/** 아무 문서의 제목. 문서가 하나도 없으면 `null`. */
export async function getRandomTitle(): Promise<string | null> {
  return unwrap(await getSupabase().rpc("random_page"));
}

/**
 * 링크의 `#문단` 후보. 문서가 없으면 `null`.
 *
 * 문서 보기 전체(`get_page_view`)를 읽는다. 넘겨주기를 따라가고 틀이 넣은 제목까지 문서 보기와 똑같이
 * 맞추려면 이것이 필요하다. 링크 대화상자에서 `#`을 친 뒤 문서 제목이 바뀔 때만 부른다.
 */
export async function listHeadings(
  title: string,
): Promise<HeadingTarget[] | null> {
  const view = await getPageView(title);
  return view.found ? headingTargets(view) : null;
}

/** 자동완성 후보 하나. 넘겨주기 문서이면 그 대상도 담는다. */
export interface TitleSuggestion {
  title: string;
  redirectTarget: string | null;
}

/** 자동완성용 제목 목록. `prefix`가 있으면 그 이름공간(`틀:`, `분류:`) 안에서만 찾는다. */
export async function suggestTitles(
  query: string,
  prefix = "",
  limit = 8,
): Promise<TitleSuggestion[]> {
  // 제목 키와 같은 꼴로 맞춘 검색어 하나로, 넓힌 정규식(걸러 내기)과 글자 그대로의 순위를 함께 만든다.
  const needle = searchKey(query);
  const rows = unwrap(
    await getSupabase().rpc("suggest_titles", {
      p_query: needle,
      p_pattern: titleMatchPattern(needle),
      // 접두어는 코드에 박힌 이름공간(`틀:` 등)이다.
      p_prefix: titleKey(prefix),
      p_limit: limit,
    }),
  );
  return rows.map((row) => ({
    title: row.title,
    redirectTarget: row.redirect_target,
  }));
}
