import { describeWriteError } from "~/features/pages";
import { isWikiError } from "~/shared/supabase/errors";

/** 즐겨찾기 더하기·빼기의 오류 문구. */
export function describeWatchError(error: unknown): string {
  if (isWikiError(error, "WK006")) {
    return "문서를 찾을 수 없습니다. 이름이 바뀌었거나 지워졌을 수 있습니다.";
  }
  return describeWriteError(error);
}
