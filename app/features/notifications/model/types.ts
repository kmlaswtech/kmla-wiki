interface NotificationBase {
  pageTitle: string;
  /** 새 판·글 수. 읽지 않은 것이 있으면 그것만, 모두 읽었으면 전체. `discussion`이면 1. */
  newCount: number;
  /** 마지막 판·글(새 토론이면 첫 글)의 이름. 그 문서의 가명이거나 '관리자'다. */
  authorName: string;
  lastAt: string;
  unread: boolean;
}

/**
 * 알림 하나.
 * - `edit`: 즐겨찾기한 문서를 남이 편집했다. 문서 하나에 하나다.
 * - `discussion`: 즐겨찾기한 문서에 새 토론이 열렸다.
 * - `reply`: 내가 글을 쓴 토론에 새 글이 왔다. 토론 하나에 하나다.
 */
export type WikiNotification =
  | (NotificationBase & {
      reason: "edit";
      /** 비교 화면의 앞 판. 새 문서라 앞 판이 없으면 `null`. */
      fromRevisionId: number | null;
      toRevisionId: number;
    })
  | (NotificationBase & {
      reason: "discussion" | "reply";
      discussionId: number;
      discussionTitle: string;
      /** 새 글 가운데 첫 글. `discussion`이면 `null`. */
      firstPostId: number | null;
    });

/** 즐겨찾기한 문서 하나. */
export interface WatchedPage {
  pageId: number;
  pageTitle: string;
  watchedAt: string;
  /** 삭제된 문서. 즐겨찾기에는 남지만 알림은 오지 않는다. */
  pageDeleted: boolean;
}
