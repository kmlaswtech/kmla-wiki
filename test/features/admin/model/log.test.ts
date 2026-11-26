import { describe, expect, it } from "vitest";

import {
  describeAdminLog,
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
    expect(describeAdminLog(base)).toBe("관리자 B 지정");
    expect(describeAdminLog({ ...base, action: "revoke_admin" })).toBe(
      "관리자 B 권한 해제",
    );
    expect(
      describeAdminLog({ ...base, action: "restore_admin", note: "기록 #3" }),
    ).toBe("관리자 B 권한 해제 되돌림 (기록 #3)");
  });

  it("keeps the old wording for records made before names", () => {
    const old = { ...base, targetHandle: null };
    expect(describeAdminLog(old)).toBe("관리자 1명 지정");
    expect(describeAdminLog({ ...old, action: "revoke_admin" })).toBe(
      "관리자 권한 1건 해제",
    );
  });
});
