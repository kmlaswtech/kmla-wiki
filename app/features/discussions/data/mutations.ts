import { DISCUSSION_INTENT } from "../model/form";
import { getSupabase } from "~/shared/supabase/client";
import { unwrap } from "~/shared/supabase/errors";

/** 토론을 연다. 새 토론 id를 돌려준다. */
export async function openDiscussion(input: {
  pageId: number;
  title: string;
  body: string;
  revisionId: number | null;
  asAdmin: boolean;
}): Promise<number> {
  return unwrap(
    await getSupabase().rpc("open_discussion", {
      p_page_id: input.pageId,
      p_title: input.title,
      p_body: input.body,
      // 붙이지 않을 때는 인자를 빼서 DB 기본값(NULL)을 쓴다.
      ...(input.revisionId === null ? {} : { p_revision_id: input.revisionId }),
      p_as_admin: input.asAdmin,
    }),
  );
}

/** 글 쓰기·닫기·다시 열기. 모두 글 하나를 쓰고 그 id를 돌려준다. */
const POST_RPC = {
  [DISCUSSION_INTENT.post]: "add_discussion_post",
  [DISCUSSION_INTENT.close]: "close_discussion",
  [DISCUSSION_INTENT.reopen]: "reopen_discussion",
} as const;

export async function writePost(
  action: keyof typeof POST_RPC,
  discussionId: number,
  body: string,
  asAdmin: boolean,
): Promise<number> {
  return unwrap(
    await getSupabase().rpc(POST_RPC[action], {
      p_discussion_id: discussionId,
      p_body: body,
      p_as_admin: asAdmin,
    }),
  );
}

export async function withdrawPost(postId: number): Promise<void> {
  unwrap(
    await getSupabase().rpc("withdraw_discussion_post", { p_post_id: postId }),
  );
}

/** 토론을 거둔다. 돌아갈 토론 목록을 위해 문서 제목을 돌려준다. */
export async function withdrawDiscussion(
  discussionId: number,
): Promise<string> {
  return unwrap(
    await getSupabase().rpc("withdraw_discussion", {
      p_discussion_id: discussionId,
    }),
  );
}

/** 관리자 전용. 사유와 함께 관리 기록에 남는다. */
export async function setPostHidden(
  postId: number,
  hidden: boolean,
  reason: string,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("set_discussion_post_hidden", {
      p_post_id: postId,
      p_hidden: hidden,
      p_reason: reason,
    }),
  );
}

/** 관리자 전용. 관리 기록 대신 토론에 '관리자' 이름으로 바꾼 사실이 남는다. */
export async function renameDiscussion(
  discussionId: number,
  title: string,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("rename_discussion", {
      p_discussion_id: discussionId,
      p_title: title,
    }),
  );
}

/** 관리자 전용. 사유와 함께 관리 기록에 남는다. */
export async function setDiscussionDeleted(
  discussionId: number,
  deleted: boolean,
  reason: string,
): Promise<void> {
  unwrap(
    await getSupabase().rpc("set_discussion_deleted", {
      p_discussion_id: discussionId,
      p_deleted: deleted,
      p_reason: reason,
    }),
  );
}
