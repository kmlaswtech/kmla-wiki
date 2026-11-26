import type { WatchedPage, WikiNotification } from "../model/types";
import { getSupabase } from "~/shared/supabase/client";
import { unwrap } from "~/shared/supabase/errors";

/** 알림 화면을 마지막으로 연 뒤에 온 알림 수. */
export async function countUnreadNotifications(): Promise<number> {
  return unwrap(await getSupabase().rpc("count_unread_notifications"));
}

/** 최근 알림 50개. 읽으면서 모두 읽음으로 표시한다(`unread`는 표시하기 전의 상태). */
export async function readNotifications(): Promise<WikiNotification[]> {
  const rows = unwrap(await getSupabase().rpc("read_notifications"));
  return rows.map((row): WikiNotification => {
    const base = {
      pageTitle: row.page_title,
      newCount: row.new_count,
      authorName: row.author_name,
      lastAt: row.last_at,
      unread: row.unread,
    };
    if (row.reason === "edit") {
      return {
        ...base,
        reason: "edit",
        fromRevisionId: row.from_revision_id,
        toRevisionId: row.to_revision_id,
      };
    }
    return {
      ...base,
      reason: row.reason === "reply" ? "reply" : "discussion",
      discussionId: row.discussion_id,
      discussionTitle: row.discussion_title,
      firstPostId: row.first_post_id,
    };
  });
}

/** 내 즐겨찾기, 제목순. */
export async function listWatchedPages(): Promise<WatchedPage[]> {
  const rows = unwrap(await getSupabase().rpc("list_watched_pages"));
  return rows.map((row) => ({
    pageId: row.page_id,
    pageTitle: row.page_title,
    watchedAt: row.watched_at,
    pageDeleted: row.page_deleted,
  }));
}
