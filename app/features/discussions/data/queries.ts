import type {
  Discussion,
  DiscussionPost,
  DiscussionSummary,
  PostKind,
  PostState,
} from "../model/types";
import { getSupabase } from "~/shared/supabase/client";
import { unwrap } from "~/shared/supabase/errors";

/** 문서의 토론 목록, 최근 활동순. 지운 토론은 관리자에게만 온다. */
export async function listPageDiscussions(
  pageId: number,
): Promise<DiscussionSummary[]> {
  const rows = unwrap(
    await getSupabase().rpc("list_page_discussions", { p_page_id: pageId }),
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    revisionId: row.revision_id,
    isOpen: row.is_open,
    openerName: row.opener_name,
    postCount: row.post_count,
    lastPostAt: row.last_post_at,
    deleted: row.deleted,
  }));
}

/** 위키 전체의 최근 토론 100개, 최근 활동순. 지운 토론은 관리자에게도 오지 않는다. */
export async function listRecentDiscussions(): Promise<DiscussionSummary[]> {
  const rows = unwrap(await getSupabase().rpc("list_recent_discussions"));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    pageTitle: row.page_title,
    revisionId: null,
    isOpen: row.is_open,
    openerName: row.opener_name,
    postCount: row.post_count,
    lastPostAt: row.last_post_at,
    deleted: false,
  }));
}

/** 판 id → 그 판에 붙은 토론 수. 기록 화면이 쓴다. */
export async function getRevisionDiscussionCounts(
  pageId: number,
): Promise<Map<number, number>> {
  const rows = unwrap(
    await getSupabase().rpc("revision_discussion_counts", {
      p_page_id: pageId,
    }),
  );
  return new Map(rows.map((row) => [row.revision_id, row.discussion_count]));
}

// RPC가 jsonb로 돌려주는 모양. DB의 `get_discussion`과 맞춘다.
interface RawPost {
  id: number;
  kind: PostKind;
  author_name: string;
  as_admin: boolean;
  state: PostState;
  body: string | null;
  created_at: string;
  mine: boolean;
}

interface RawDiscussion {
  id: number;
  page_title: string;
  title: string;
  revision_id: number | null;
  is_open: boolean;
  close_after: string;
  opened_by_me: boolean;
  created_by_me: boolean;
  deleted: boolean;
  posts: RawPost[];
}

function toPost(raw: RawPost): DiscussionPost {
  return {
    id: raw.id,
    kind: raw.kind,
    authorName: raw.author_name,
    asAdmin: raw.as_admin,
    state: raw.state,
    body: raw.body,
    createdAt: raw.created_at,
    mine: raw.mine,
  };
}

/** 토론 하나와 글 전체. 없거나, 거뒀거나, 지운 토론(관리자가 아니면)은 `null`. */
export async function findDiscussion(id: number): Promise<Discussion | null> {
  const result = await getSupabase().rpc("get_discussion", {
    p_discussion_id: id,
  });
  if (result.error?.code === "WK006") return null;
  const raw = unwrap(result) as unknown as RawDiscussion;
  return {
    id: raw.id,
    pageTitle: raw.page_title,
    title: raw.title,
    revisionId: raw.revision_id,
    isOpen: raw.is_open,
    closeAfter: raw.close_after,
    openedByMe: raw.opened_by_me,
    createdByMe: raw.created_by_me,
    deleted: raw.deleted,
    posts: raw.posts.map(toPost),
  };
}
