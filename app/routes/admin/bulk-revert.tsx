import { data, Link, redirect, useRevalidator } from "react-router";

import type { Route } from "./+types/bulk-revert";
import {
  authorEditsHref,
  BulkRevertView,
  getAuthorLookup,
  isLookupExpired,
  previewBulkRevert,
} from "~/features/admin";
import { loadMemberStatus, withVerifiedMember } from "~/features/auth";

const DIGITS = /^\d+$/;

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // 화면을 가리는 검사다. 실제 권한은 RPC가 검사한다.
  const status = await loadMemberStatus();
  if (!status?.isAdmin) throw redirect("/");

  const params = new URL(request.url).searchParams;
  const src = params.get("src") ?? "";
  const lookupId = params.get("lookup");
  const from = params.get("from");
  if (!DIGITS.test(src) || !lookupId || (from !== null && !DIGITS.test(from)))
    throw data(null, { status: 404 });
  const sourceRevisionId = Number(src);
  const fromRevisionId = from === null ? null : Number(from);

  try {
    const [lookup, rows] = await withVerifiedMember(request, () =>
      Promise.all([
        getAuthorLookup(lookupId),
        previewBulkRevert(lookupId, fromRevisionId),
      ]),
    );
    return {
      expired: false as const,
      lookupId,
      sourceRevisionId,
      fromRevisionId,
      ...lookup,
      rows,
    };
  } catch (error) {
    if (isLookupExpired(error))
      return { expired: true as const, sourceRevisionId };
    throw error;
  }
}

export const meta: Route.MetaFunction = () => [
  { title: "일괄 되돌리기 - 큼온 위키" },
];

/**
 * 한 사람의 편집을 여러 문서에서 한 번에 되돌린다(관리자 전용). 사람은 주소에 없고, 열린 조회 허가의
 * ID로만 가리킨다. 허가가 끝나면 근거 판에서 다시 조회한다.
 */
export default function BulkRevertRoute({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();

  if (loaderData.expired) {
    return (
      <div>
        <h1 className="mb-4 border-b pb-3 text-2xl font-bold">일괄 되돌리기</h1>
        <p role="status" className="text-sm">
          조회 허가가 끝났습니다.{" "}
          <Link
            to={authorEditsHref(loaderData.sourceRevisionId)}
            className="text-primary hover:underline"
          >
            사유를 적고 다시 조회
          </Link>
        </p>
      </div>
    );
  }
  return (
    <BulkRevertView
      // 범위를 바꾸면 고른 칸, 펼친 줄, 결과 안내를 새로 시작한다. 실행 뒤 다시 읽을 때는 그대로 둔다.
      key={loaderData.fromRevisionId ?? "all"}
      lookupId={loaderData.lookupId}
      sourceRevisionId={loaderData.sourceRevisionId}
      source={loaderData.source}
      expiresAt={loaderData.expiresAt}
      fromRevisionId={loaderData.fromRevisionId}
      rows={loaderData.rows}
      onDone={() => void revalidator.revalidate()}
    />
  );
}
