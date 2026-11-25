import type { ReportNote } from "~/features/reports";

/** 토론 목록 한 줄(`list_page_discussions`, `list_recent_discussions`). */
export interface DiscussionSummary {
  id: number;
  title: string;
  /** 토론이 있는 문서. 최근 토론 목록에만 있다. */
  pageTitle?: string;
  /** 토론을 붙인 판. */
  revisionId: number | null;
  isOpen: boolean;
  /** 연 사람의 이름(그 문서의 가명 또는 '관리자'). */
  openerName: string;
  /** 거두지 않은 글 수(첫 글 포함). */
  postCount: number;
  lastPostAt: string;
  /** 관리자가 지운 토론. 관리자에게만 나온다. */
  deleted: boolean;
}

/** `open`은 첫 글, `close`·`reopen`은 닫기·다시 열기와 함께 쓴 글이다. */
export type PostKind = "open" | "post" | "close" | "reopen" | "rename";

/** `withdrawn`은 작성자가 거둔 글, `hidden`은 관리자가 숨긴 글이다. */
export type PostState = "visible" | "withdrawn" | "hidden";

export interface DiscussionPost {
  id: number;
  kind: PostKind;
  authorName: string;
  asAdmin: boolean;
  state: PostState;
  /** 보이지 않는 글은 관리자에게만 본문이 온다. */
  body: string | null;
  createdAt: string;
  mine: boolean;
}

/** 토론 하나와 글 전체(`get_discussion`). */
export interface Discussion {
  id: number;
  pageTitle: string;
  title: string;
  revisionId: number | null;
  isOpen: boolean;
  /** 이 시각이 지나면 누구나 닫을 수 있다. */
  closeAfter: string;
  /** 지금 열린 차례를 내가 열었다(언제나 닫을 수 있다). */
  openedByMe: boolean;
  /** 토론을 처음 연 사람이 나다(토론 거두기). */
  createdByMe: boolean;
  deleted: boolean;
  /** 변경 표. 토론 화면이 새 글을 확인할 때 견준다(`get_discussion_version`). */
  version: string;
  posts: DiscussionPost[];
}

/** 처리되지 않은 토론 글 신고, 글별로 묶음(`list_open_post_reports`, 관리자 전용). */
export interface OpenPostReport {
  postId: number;
  discussionId: number;
  discussionTitle: string;
  pageTitle: string;
  authorName: string;
  kind: PostKind;
  /** 상태와 관계없이 온다. 관리자가 판단해야 하기 때문이다. */
  body: string;
  postCreatedAt: string;
  state: PostState;
  /** 연 사람이 거둔 토론. 관리자도 열 수 없다. */
  discussionWithdrawn: boolean;
  /** 지운 토론이거나 삭제된 문서의 토론. 회원에게 보이지 않는다. */
  discussionDeleted: boolean;
  reports: ReportNote[];
  /** 같은 글에서 전에 기각한 신고 수. */
  dismissedCount: number;
}
