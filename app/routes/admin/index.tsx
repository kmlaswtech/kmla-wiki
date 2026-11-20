import { useState } from "react";
import { Link, redirect, useRevalidator } from "react-router";

import type { Route } from "./+types/index";
import {
  listAdmins,
  listMyAuthorLookups,
  listOpenReports,
  OpenLookupList,
  OpenReportList,
  ReasonDialog,
  revokeAdmin,
} from "~/features/admin";
import { loadMemberStatus, withVerifiedMember } from "~/features/auth";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // 화면을 가리는 검사다. 실제 권한은 각 RPC가 검사한다.
  const status = await loadMemberStatus();
  if (!status?.isAdmin) throw redirect("/");
  const [admins, lookups, reports] = await withVerifiedMember(request, () =>
    Promise.all([listAdmins(), listMyAuthorLookups(), listOpenReports()]),
  );
  return { admins, lookups, reports };
}

export const meta: Route.MetaFunction = () => [{ title: "관리 - 큼온 위키" }];

/**
 * 관리자 화면. 조치 대부분은 대상이 있는 자리(판 기록, 문서)에서 하고, 여기에는 대상이 없는
 * 것(관리자 목록)과 다른 화면으로 가는 길만 둔다.
 */
export default function AdminRoute({ loaderData }: Route.ComponentProps) {
  const { admins, lookups, reports } = loaderData;
  const revalidator = useRevalidator();
  const [revoking, setRevoking] = useState<string | null>(null);

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="border-b pb-3 text-2xl font-bold">관리</h1>

      <section>
        <h2 className="mb-2 text-lg font-semibold">어디서 무엇을 하나</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>
              차단, 판 숨기기, 관리자 지정, 같은 사람의 다른 편집 보기
            </strong>
            : 문서의 [기록]에서 해당 판 오른쪽의 방패 버튼
          </li>
          <li>
            <strong>한 사람의 편집을 여러 문서에서 되돌리기</strong>: 다른 편집
            보기 화면의 [일괄 되돌리기] 또는 각 줄의 [여기부터 되돌리기]
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
          회원이 관리자에게 알린 판입니다. 누가 신고했는지는 보이지 않습니다.
          조치한 뒤에는 [처리함], 조치할 일이 없으면 [기각]으로 닫습니다. 닫은
          결과는 공개 기록에 남지 않습니다.
        </p>
        <OpenReportList
          reports={reports}
          onChanged={() => void revalidator.revalidate()}
        />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">진행 중인 조회</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          내가 연 &quot;다른 편집 보기&quot; 허가입니다. 끝나기 전에는 사유를
          다시 적지 않고 들어갈 수 있습니다.
        </p>
        <OpenLookupList lookups={lookups} />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">관리자 {admins.length}명</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          관리자끼리는 아래 이름으로 구분합니다. 이 이름은 문서의 가명과 이어
          보이지 않고, 일반 회원에게는 인원수만 보입니다.
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
            마지막 관리자는 해제할 수 없습니다.
          </p>
        ) : null}
      </section>

      <ReasonDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="관리자 해제"
        description={`${revoking ?? ""}의 관리자 권한을 거둡니다. 공개 기록에는 "관리자 1명을 해제함"으로 남습니다.`}
        confirmLabel="해제"
        destructive
        onConfirm={(reason) => revokeAdmin(revoking ?? "", reason)}
        onDone={() => void revalidator.revalidate()}
      />
    </div>
  );
}
