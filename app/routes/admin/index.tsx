import { useState } from "react";
import { Link, redirect, useRevalidator } from "react-router";

import type { Route } from "./+types/index";
import {
  AdminNicknameForm,
  listAdmins,
  listMyAuthorLookups,
  listOpenReports,
  listRestorableRevocations,
  OpenLookupList,
  OpenReportList,
  ReasonDialog,
  revokeAdmin,
  RestorableRevocationList,
} from "~/features/admin";
import { loadMemberStatus, withVerifiedMember } from "~/features/auth";
import { listOpenPostReports, PostReportList } from "~/features/discussions";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // 화면을 가리는 검사다. 실제 권한은 각 RPC가 검사한다.
  const status = await loadMemberStatus();
  if (!status?.isAdmin) throw redirect("/");
  const [admins, revocations, lookups, reports, postReports] =
    await withVerifiedMember(request, () =>
      Promise.all([
        listAdmins(),
        listRestorableRevocations(),
        listMyAuthorLookups(),
        listOpenReports(),
        listOpenPostReports(),
      ]),
    );
  return { admins, revocations, lookups, reports, postReports };
}

export const meta: Route.MetaFunction = () => [{ title: "관리 - 큼온 위키" }];

/**
 * 관리자 화면. 조치 대부분은 대상이 있는 자리(판 기록, 문서)에서 하고, 여기에는 대상이 없는
 * 것(관리자 목록)과 다른 화면으로 가는 길만 둔다.
 */
export default function AdminRoute({ loaderData }: Route.ComponentProps) {
  const { admins, revocations, lookups, reports, postReports } = loaderData;
  const reportCount = reports.length + postReports.length;
  const revalidator = useRevalidator();
  const [revoking, setRevoking] = useState<string | null>(null);
  const me = admins.find((admin) => admin.isMe);

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
          신고{reportCount > 0 ? ` ${reportCount}건` : ""}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          신고 대상이 판 숨김, 문서 삭제, 일괄 되돌리기, 토론 글 숨김 또는 토론
          지우기로 제거되면 신고가 자동으로 처리됩니다. 별도로 조치했다면 ‘처리
          완료’, 조치가 필요 없다면 ‘기각’을 선택하세요. 같은 회원은 기각된
          판이나 글을 다시 신고할 수 없습니다. 신고 처리 결과는 공개 기록에 남지
          않습니다.
        </p>
        <h3 className="mb-2 text-sm font-semibold">
          판{reports.length > 0 ? ` ${reports.length}건` : ""}
        </h3>
        <OpenReportList
          reports={reports}
          onChanged={() => void revalidator.revalidate()}
        />
        <h3 className="mt-4 mb-2 text-sm font-semibold">
          토론 글{postReports.length > 0 ? ` ${postReports.length}건` : ""}
        </h3>
        <PostReportList
          reports={postReports}
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
          관리자 이름은 관리자로 한 일(판, 토론 글, 관리 기록)에 공개로 남지만
          문서의 가명과 연결되지 않습니다. 별명은 관리자에게만 표시됩니다. 한 번
          받은 이름은 다른 사람에게 주지 않습니다.
        </p>
        <ul className="divide-y rounded-md border text-sm">
          {admins.map((admin) => (
            <li
              key={admin.handle}
              className="flex items-center gap-2 px-3 py-2"
            >
              <span className="font-medium">{admin.handle}</span>
              {admin.nickname ? (
                <span className="min-w-0 truncate text-muted-foreground">
                  ({admin.nickname})
                </span>
              ) : null}
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
        <AdminNicknameForm
          key={me?.nickname ?? ""}
          nickname={me?.nickname ?? null}
          onChanged={() => void revalidator.revalidate()}
        />
      </section>

      {revocations.length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-semibold">최근 해제</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            잘못 해제했다면 7일 안에 되돌릴 수 있습니다. 같은 사람이 같은
            이름으로 다시 관리자가 됩니다. 7일이 지나면 판 기록에서 다시
            지정해야 합니다. 그때도 같은 이름을 받습니다.
          </p>
          <RestorableRevocationList
            revocations={revocations}
            onChanged={() => void revalidator.revalidate()}
          />
        </section>
      ) : null}

      <ReasonDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="관리자 권한 해제"
        description={`‘${revoking ?? ""}’의 관리자 권한을 해제합니다. 공개 기록에는 해제한 관리자와 해제된 관리자의 이름이 표시됩니다. 별명은 지워집니다. 잘못 해제했다면 7일 안에 이 화면에서 되돌릴 수 있습니다.`}
        confirmLabel="해제"
        destructive
        onConfirm={(reason) => revokeAdmin(revoking ?? "", reason)}
        onDone={() => void revalidator.revalidate()}
      />
    </div>
  );
}
