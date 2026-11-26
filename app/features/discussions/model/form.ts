/** 토론 화면의 폼 칸 이름. 컴포넌트와 라우트의 `clientAction`이 같이 쓴다. */
export const DISCUSSION_FIELD = {
  intent: "intent",
  title: "title",
  body: "body",
  revisionId: "revisionId",
  asAdmin: "asAdmin",
  postId: "postId",
} as const;

/** 토론 화면에서 보내는 동작. */
export const DISCUSSION_INTENT = {
  post: "post",
  close: "close",
  reopen: "reopen",
  withdrawPost: "withdraw-post",
  withdrawDiscussion: "withdraw-discussion",
} as const;

export type DiscussionIntent =
  (typeof DISCUSSION_INTENT)[keyof typeof DISCUSSION_INTENT];

export function isDiscussionIntent(value: string): value is DiscussionIntent {
  return (Object.values(DISCUSSION_INTENT) as string[]).includes(value);
}

/** `clientAction`이 돌려주는 결과. 성공하면 `ok`, 실패하면 보여 줄 문구. */
export type DiscussionActionResult =
  | { ok: true; intent: DiscussionIntent }
  | { ok: false; intent: DiscussionIntent | null; error: string };
