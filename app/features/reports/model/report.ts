import { describeWriteError } from "~/features/pages";
import { isWikiError } from "~/shared/supabase/errors";

export type ReportCategory = "privacy" | "abuse" | "vandalism" | "other";

/** 신고 종류. 서버의 `reports_category` 제약과 같다. */
export const REPORT_CATEGORIES: readonly {
  value: ReportCategory;
  label: string;
  hint?: string;
}[] = [
  {
    value: "privacy",
    label: "개인정보·사생활",
    hint: "실명, 연락처 또는 공개하기 어려운 사생활 정보",
  },
  { value: "abuse", label: "욕설·비방" },
  {
    value: "vandalism",
    label: "훼손·장난",
    hint: "되돌려도 반복되는 문서 훼손",
  },
  { value: "other", label: "기타", hint: "신고 사유를 입력해 주세요." },
];

export function reportCategoryLabel(category: string): string {
  return (
    REPORT_CATEGORIES.find((entry) => entry.value === category)?.label ??
    category
  );
}

/** 덧붙임 길이. 서버와 같다. */
export const REPORT_NOTE_MAX = 300;

/** 보낼 수 있는가. 기타는 덧붙임이 2자 이상이어야 한다. */
export function canSubmitReport(
  category: ReportCategory | null,
  note: string,
): boolean {
  if (category === null) return false;
  const length = note.trim().length;
  if (length > REPORT_NOTE_MAX) return false;
  return category !== "other" || length >= 2;
}

// DB migration(`*_admin_bulk_revert_reports.sql`) 머리말의 표와 같다.
const MESSAGE: Record<string, string> = {
  WK005: `상세 내용은 ${REPORT_NOTE_MAX}자까지 입력할 수 있습니다.`,
  WK006: "이 판은 신고할 수 없습니다.",
  WK011:
    "이미 신고한 판입니다. 신고가 처리되기 전이나 기각된 뒤에는 같은 판을 다시 신고할 수 없습니다.",
  WK014: "‘기타’를 선택하면 상세 내용을 2자 이상 입력해 주세요.",
  WK019: "신고는 1시간에 10건까지 할 수 있습니다.",
};

export function describeReportError(error: unknown): string {
  if (isWikiError(error)) {
    const message = MESSAGE[error.code];
    if (message) return message;
  }
  return describeWriteError(error);
}
