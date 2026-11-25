import { describe, expect, it } from "vitest";

import {
  canSubmitReport,
  describeReportError,
  describeReportTarget,
  reportCategoryLabel,
} from "~/features/reports/model/report";
import { WikiError } from "~/shared/supabase/errors";

describe("canSubmitReport", () => {
  it("needs a category", () => {
    expect(canSubmitReport(null, "내용")).toBe(false);
  });

  it("allows an empty note except for other", () => {
    expect(canSubmitReport("privacy", "")).toBe(true);
    expect(canSubmitReport("other", " a ")).toBe(false);
    expect(canSubmitReport("other", "설명")).toBe(true);
  });

  it("limits the note to 300 characters", () => {
    expect(canSubmitReport("abuse", "가".repeat(300))).toBe(true);
    expect(canSubmitReport("abuse", "가".repeat(301))).toBe(false);
  });
});

describe("reportCategoryLabel", () => {
  it("names known categories and passes unknown ones through", () => {
    expect(reportCategoryLabel("vandalism")).toBe("훼손·장난");
    expect(reportCategoryLabel("new")).toBe("new");
  });
});

describe("describeReportError", () => {
  it("explains the report limits", () => {
    expect(describeReportError(new WikiError("WK019", "too many"))).toContain(
      "1시간에 10건",
    );
    expect(describeReportError(new WikiError("WK011", "again"))).toContain(
      "이미 신고",
    );
  });

  it("names a post when a post report fails", () => {
    expect(describeReportError(new WikiError("WK011", "again"), "post")).toBe(
      "이미 신고한 글입니다. 신고가 처리되기 전이나 기각된 뒤에는 같은 글을 다시 신고할 수 없습니다.",
    );
  });
});

describe("describeReportTarget", () => {
  it("names a revision or a post", () => {
    expect(
      describeReportTarget({ kind: "revision", id: 3, pageTitle: "귀가" }),
    ).toBe("‘귀가’ r3");
    expect(
      describeReportTarget({
        kind: "post",
        id: 9,
        pageTitle: "귀가",
        authorName: "익명#AB12",
      }),
    ).toBe("‘귀가’ 토론의 익명#AB12 글");
  });
});
