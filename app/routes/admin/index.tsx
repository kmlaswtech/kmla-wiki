import { useState } from "react";
import { Link, redirect, useRevalidator } from "react-router";

import type { Route } from "./+types/index";
import {
  listAdmins,
  listMyAuthorLookups,
  listOpenReports,
  listRestorableRevocations,
  OpenLookupList,
  OpenReportList,
  ReasonDialog,
  restoreRevokedAdmin,
  revokeAdmin,
  type RestorableRevocation,
} from "~/features/admin";
import { loadMemberStatus, withVerifiedMember } from "~/features/auth";
import { formatDateTime } from "~/shared/lib/time";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // 화면을 가리는 검사다. 실제 권한은 각 RPC가 검사한다.
  const status = await loadMemberStatus();
  if (!status?.isAdmin) throw redirect("/");
  const [admins, revocations, lookups, reports] = await withVerifiedMember(
    request,
    () =>
      Promise.all([
        listAdmins(),
        listRestorableRevocations(),
        listMyAuthorLookups(),
        listOpenReports(),
      ]),
  );
  return { admins, revocations, lookups, reports };
}

export const meta: Route.MetaFunction = () => [{ title: "관리 - 큼온 위키" }];

/**
 * 관리자 화면. 조치 대부분은 대상이 있는 자리(판 기록, 문서)에서 하고, 여기에는 대상이 없는
 * 것(관리자 목록)과 다른 화면으로 가는 길만 둔다.
 */
export default function AdminRoute({ loaderData }: Route.ComponentProps) {
  const { admins, revocations, lookups, reports } = loaderData;
  const revalidator = useRevalidator();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<RestorableRevocation | null>(null);

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="border-b pb-3 text-2xl font-bold">관리</h1>

      <section>
        <h2 className="mb-2 text-lg font-semibold">관리 기능 위치</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            편집자 관리와 판 숨김은 문서의 편집 기록에서 해당 판의 방패 버튼을
            누릅니다.
          </li>
          <li>
            여러 문서를 되돌리려면 ‘다른 편집 조회’에서 ‘일괄 되돌리기’를
            선택합니다. 특정 판부터 되돌리려면 ‘이 판부터 되돌리기’를
            선택합니다.
          </li>
          <li>
            <strong>문서 보호, 삭제·복구</strong>: 문서 화면의 [관리] 버튼
          </li>
          <li>
            <strong>차단 해제</strong>:{" "}
            <Link to="/bans" className="text-primary hover:underline">
              차단 내역
            </Link>
          </li>
          <li>
            <strong>지금까지의 조치</strong>:{" "}
            <Link to="/log" className="text-primary hover:underline">
              관리 기록
            </Link>{" "}
            (모든 회원에게 공개)
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">
          신고{reports.length > 0 ? ` ${reports.length}건` : ""}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          신고 대상이 판 숨김, 문서 삭제 또는 일괄 되돌리기로 제거되면 신고가
          자동으로 처리됩니다. 별도로 조치했다면 ‘처리 완료’, 조치가 필요 없다면
          ‘기각’을 선택하세요. 같은 회원은 기각된 판을 다시 신고할 수 없습니다.
          신고 처리 결과는 공개 기록에 남지 않습니다.
        </p>
        <OpenReportList
          reports={reports}
          onChanged={() => void revalidator.revalidate()}
        />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">이용 가능한 편집 조회</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          표시된 시간까지 사유를 다시 입력하지 않고 조회할 수 있습니다.
        </p>
        <OpenLookupList lookups={lookups} />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">관리자 {admins.length}명</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          아래 이름은 관리자에게만 표시되며 문서의 가명과 연결되지 않습니다.
          일반 회원에게는 관리자 수만 공개됩니다.
        </p>
        <ul className="divide-y rounded-md border text-sm">
          {admins.map((admin) => (
            <li
              key={admin.handle}
              className="flex items-center gap-2 px-3 py-2"
            >
              <span className="font-medium">{admin.handle}</span>
              {admin.isMe ? <Badge variant="secondary">나</Badge> : null}
              <Button
                className="ml-auto"
                size="xs"
                variant="ghost"
                disabled={admins.length <= 1}
                onClick={() => setRevoking(admin.handle)}
              >
                해제
              </Button>
            </li>
          ))}
        </ul>
        {admins.length <= 1 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            마지막 관리자의 권한은 해제할 수 없습니다.
          </p>
        ) : null}
      </section>

      {revocations.length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold">최근 해제</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            잘못 해제했다면 7일 안에 되돌릴 수 있습니다. 같은 사람이 같은
            이름으로 다시 관리자가 됩니다. 7일이 지나면 판 기록에서 다시
            지정해야 합니다.
          </p>
          <ul className="divide-y rounded-md border text-sm">
            {revocations.map((revocation) => (
              <li
                key={revocation.logId}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2"
              >
                <span className="font-medium">{revocation.handle}</span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {revocation.reason}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(revocation.restorableUntil)}까지
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setRestoring(revocation)}
                  >
                    되돌리기
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ReasonDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="관리자 권한 해제"
        description={`‘${revoking ?? ""}’의 관리자 권한을 해제합니다. 공개 기록에는 해제된 관리자의 이름이 표시되지 않습니다. 잘못 해제했다면 7일 안에 이 화면에서 되돌릴 수 있습니다.`}
        confirmLabel="해제"
        destructive
        onConfirm={(reason) => revokeAdmin(revoking ?? "", reason)}
        onDone={() => void revalidator.revalidate()}
      />

      <ReasonDialog
        open={restoring !== null}
        onOpenChange={(open) => !open && setRestoring(null)}
        title="관리자 해제 되돌리기"
        description={`‘${restoring?.handle ?? ""}’의 해제를 되돌려 같은 사람에게 관리자 권한을 다시 줍니다. 공개 기록에는 어느 해제를 되돌렸는지만 표시됩니다.`}
        confirmLabel="되돌리기"
        onConfirm={async (reason) => {
          if (restoring) await restoreRevokedAdmin(restoring.logId, reason);
        }}
        onDone={() => void revalidator.revalidate()}
      />
    </div>
  );
}
