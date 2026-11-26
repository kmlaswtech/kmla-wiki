import type { Discussion, DiscussionPost } from "./types";

/** 글자 수 한도. DB(`80-discussions.sql`)와 같다. */
export const DISCUSSION_LIMIT = {
  title: 80,
  post: 4000,
  /** 닫기·다시 열기 글의 최소 글자 수. */
  conclusion: 10,
} as const;

/**
 * 서버(`check_discussion_body`)처럼 줄바꿈을 맞추고 앞뒤의 공백·탭·줄바꿈만 뺀 글자 수. `trim()`은
 * 전각 공백 같은 다른 공백도 빼서 서버와 수가 달라진다.
 */
export function postLength(body: string): number {
  return [
    ...body.replace(/\r\n/g, "\n").replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, ""),
  ].length;
}

/** 토론 주소. 제목에 `/`가 들어갈 수 있어 문서 제목이 아니라 번호로 가리킨다. */
export function topicHref(id: number): string {
  return `/topic/${id}`;
}

/** 토론 글 하나의 주소. 글 카드의 `id`(`post-<번호>`)로 간다. */
export function postHref(discussionId: number, postId: number): string {
  return `${topicHref(discussionId)}#${postAnchor(postId)}`;
}

/** 토론 화면에서 글 카드의 `id`. */
export function postAnchor(postId: number): string {
  return `post-${postId}`;
}

export type CloseState =
  | { kind: "allowed" }
  /** 24시간이 지나지 않았다. 관리자는 '관리자로' 일찍 닫을 수 있다. */
  | { kind: "wait"; until: string };

/** 지금 닫을 수 있는가. 서버의 `close_discussion`과 같은 판단이다. */
export function closeState(discussion: Discussion, now: number): CloseState {
  if (discussion.openedByMe) return { kind: "allowed" };
  return new Date(discussion.closeAfter).getTime() <= now
    ? { kind: "allowed" }
    : { kind: "wait", until: discussion.closeAfter };
}

/** 닫을 수 있을 때까지 남은 시간. "3시간 20분", "15분". */
export function formatRemaining(until: string, now: number): string {
  const minutes = Math.max(
    1,
    Math.ceil((new Date(until).getTime() - now) / 60_000),
  );
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}분`;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

/**
 * 거두기를 막는 답글인가. 거두지 않은 글만 센다. 첫 글과 제목 바꾸기 글은 답글이 아니다. 서버의
 * `private.discussion_has_replies`와 같은 판단이다.
 */
function countsAsReply(post: DiscussionPost): boolean {
  return (
    post.kind !== "open" && post.kind !== "rename" && post.state !== "withdrawn"
  );
}

/**
 * 이 글을 거둘 수 있는가. 내 글이고, 숨기지 않은 일반 글이고, 뒤에 거두지 않은 글(제목 바꾸기 글
 * 말고)이 없어야 한다. 서버의 `withdraw_discussion_post`와 같은 판단이다.
 */
export function canWithdrawPost(
  posts: readonly DiscussionPost[],
  post: DiscussionPost,
): boolean {
  if (!post.mine || post.kind !== "post" || post.state !== "visible") {
    return false;
  }
  return !posts.some((other) => other.id > post.id && countsAsReply(other));
}

/** 토론을 거둘 수 있는가. 내가 열었고 첫 글과 제목 바꾸기 글 말고 거두지 않은 글이 없어야 한다. */
export function canWithdrawDiscussion(discussion: Discussion): boolean {
  return discussion.createdByMe && !discussion.posts.some(countsAsReply);
}
