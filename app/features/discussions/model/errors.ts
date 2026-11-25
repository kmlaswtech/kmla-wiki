import { DISCUSSION_LIMIT } from "./rules";
import { describeWriteError } from "~/features/pages";
import { isWikiError } from "~/shared/supabase/errors";

// DB migration(`*_discussions.sql`) 머리말의 표와 같다.
const MESSAGE: Record<string, string> = {
  WK002: "차단 기간에는 토론에 글을 쓸 수 없습니다.",
  WK006: "토론을 찾을 수 없습니다. 지워졌거나 거둔 토론입니다.",
  WK008: "삭제된 문서의 토론에는 글을 쓸 수 없습니다.",
  WK011: "이미 처리된 상태입니다. 화면을 새로 고쳐 주세요.",
  WK022: "닫힌 토론입니다. 다시 열어야 글을 쓸 수 있습니다.",
  WK023: "토론이 열린 지 24시간이 지나야 닫을 수 있습니다.",
};

const LIMIT_MESSAGE: Record<string, string> = {
  post: `글은 ${DISCUSSION_LIMIT.post}자까지 쓸 수 있습니다.`,
  title: `제목은 ${DISCUSSION_LIMIT.title}자까지 쓸 수 있습니다.`,
  rate: "글을 너무 자주 쓰고 있습니다. 잠시 뒤에 다시 시도해 주세요.",
};

const SHORT_MESSAGE: Record<string, string> = {
  post: "글을 입력해 주세요.",
  title: "제목을 입력해 주세요.",
  conclusion: `닫거나 다시 열 때는 글을 ${DISCUSSION_LIMIT.conclusion}자 이상 써 주세요.`,
};

const WITHDRAW_MESSAGE: Record<string, string> = {
  replies: "뒤에 다른 글이 있어 거둘 수 없습니다.",
  kind: "이 글은 거둘 수 없습니다.",
};

export function describeDiscussionError(error: unknown): string {
  if (isWikiError(error)) {
    const detail = error.detail ?? "";
    if (error.code === "WK005")
      return LIMIT_MESSAGE[detail] ?? LIMIT_MESSAGE.post!;
    if (error.code === "WK014")
      return SHORT_MESSAGE[detail] ?? SHORT_MESSAGE.post!;
    if (error.code === "WK024") {
      return WITHDRAW_MESSAGE[detail] ?? WITHDRAW_MESSAGE.kind!;
    }
    const message = MESSAGE[error.code];
    if (message) return message;
  }
  return describeWriteError(error);
}
