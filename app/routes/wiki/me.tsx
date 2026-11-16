import { Link, useOutletContext } from "react-router";

import type { MemberStatus } from "~/features/auth";
import { pageHref } from "~/features/markup";
import { LinkButton } from "~/shared/components/link-button";
import { formatDateTime } from "~/shared/lib/time";

export const meta = () => [{ title: "내 정보 - 큼온 위키" }];

/**
 * 내 이용 상태. 위키에는 이름·이메일이 없어서 보여 줄 신상 정보가 없다.
 * 가명도 여기에 없다. 가명은 문서마다 다르고, 각 문서의 판 기록에서 "나" 표시로 확인한다.
 */
export default function MeRoute() {
  const status = useOutletContext<MemberStatus>();

  return (
    <div className="max-w-xl">
      <h1 className="mb-4 border-b pb-3 text-2xl font-bold">내 정보</h1>

      <dl className="divide-y text-sm">
        <Row label="회원 확인">
          {status.verifiedUntil
            ? `${formatDateTime(status.verifiedUntil)}까지 유효`
            : "없음"}
          <p className="mt-1 text-muted-foreground">
            기간이 지나면 "큼온으로 로그인"을 한 번 더 거칩니다. KMLA Online에
            로그인돼 있으면 화면 이동만으로 끝납니다.
          </p>
        </Row>
        <Row label="편집">
          {status.ban ? (
            <>
              <span className="font-medium text-destructive">
                차단됨{" "}
                {status.ban.endsAt
                  ? `(${formatDateTime(status.ban.endsAt)}까지)`
                  : "(기한 없음)"}
              </span>
              <p className="mt-1 text-muted-foreground">
                사유: {status.ban.reason}
              </p>
              <p className="mt-1 text-muted-foreground">
                차단 중에도 문서는 볼 수 있습니다.
              </p>
            </>
          ) : (
            "가능"
          )}
        </Row>
        <Row label="가명">
          <p className="text-muted-foreground">
            편집 기록에는 실명 대신 가명이 남고, 가명은 문서마다 다릅니다. 각
            문서의 기록에서 내가 쓴 판에는 "나" 표시가 붙습니다. 익명성이
            어디까지 지켜지는지는{" "}
            <Link
              to={pageHref("위키:이용 안내")}
              className="text-primary hover:underline"
            >
              이용 안내
            </Link>
            에 적혀 있습니다.
          </p>
        </Row>
        {status.isAdmin ? <Row label="권한">관리자</Row> : null}
      </dl>

      <LinkButton className="mt-6" variant="outline" to="/logout">
        로그아웃
      </LinkButton>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2 py-3">
      <dt className="font-medium">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
