import { describe, expect, it } from "vitest";

import {
  describeAdminLog,
  withParticle,
  type AdminLogEntry,
} from "~/features/admin/model/log";

const base: AdminLogEntry = {
  id: 1,
  action: "grant_admin",
  pageTitle: null,
  revisionId: null,
  pseudonym: null,
  reason: "운영 도움",
  note: null,
  discussionId: null,
  actorHandle: "관리자 A",
  targetHandle: "관리자 B",
  createdAt: "2026-11-26T00:00:00Z",
};

describe("describeAdminLog", () => {
  it("names the target admin of a grant, revocation and restore", () => {
    expect(describeAdminLog(base)).toBe("관리자 B를 관리자로 지정");
    expect(describeAdminLog({ ...base, action: "revoke_admin" })).toBe(
      "관리자 B의 관리자 권한 해제",
    );
    expect(
      describeAdminLog({ ...base, action: "restore_admin", note: "기록 #3" }),
    ).toBe("관리자 B의 관리자 권한 해제 되돌림 (기록 #3)");
  });

  it("keeps the old wording for records made before names", () => {
    const old = { ...base, targetHandle: null };
    expect(describeAdminLog(old)).toBe("관리자 1명 지정");
    expect(describeAdminLog({ ...old, action: "revoke_admin" })).toBe(
      "관리자 권한 1건 해제",
    );
  });
});

describe("withParticle", () => {
  it("reads a letter the way it sounds", () => {
    expect(withParticle("관리자 A", "이", "가")).toBe("관리자 A가");
    expect(withParticle("관리자 L", "이", "가")).toBe("관리자 L이");
    expect(withParticle("관리자 M", "을", "를")).toBe("관리자 M을");
    expect(withParticle("관리자 R", "이", "가")).toBe("관리자 R이");
  });

  it("reads a number by its last digit", () => {
    expect(withParticle("관리자 27", "이", "가")).toBe("관리자 27이");
    expect(withParticle("관리자 29", "이", "가")).toBe("관리자 29가");
    expect(withParticle("관리자 30", "이", "가")).toBe("관리자 30이");
  });

  it("reads a final Hangul syllable", () => {
    expect(withParticle("관리자", "이", "가")).toBe("관리자가");
    expect(withParticle("운영진", "이", "가")).toBe("운영진이");
  });
});
