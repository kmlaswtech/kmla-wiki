import { data, redirect, useNavigate, useRevalidator } from "react-router";

import type { Route } from "./+types/author-edits";
import {
  AuthorEditsResult,
  AuthorLookupForm,
  getAuthorLookup,
  isLookupExpired,
  listAuthorEdits,
} from "~/features/admin";
import { loadMemberStatus, withVerifiedMember } from "~/features/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // 화면을 가리는 검사다. 실제 권한은 RPC가 검사한다.
  const status = await loadMemberStatus();
  if (!status?.isAdmin) throw redirect("/");

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  if (!/^\d+$/.test(from)) throw data(null, { status: 404 });
  const revisionId = Number(from);

  const lookupId = params.get("lookup");
  if (!lookupId) return { revisionId, lookup: null, expired: false };
  // 손으로 고친 주소. DB의 uuid 형 오류로 오류 화면에 가지 않고 끝난 허가처럼 다룬다.
  if (!UUID.test(lookupId)) return { revisionId, lookup: null, expired: true };

  try {
    const [lookup, edits] = await withVerifiedMember(request, () =>
      Promise.all([getAuthorLookup(lookupId), listAuthorEdits(lookupId)]),
    );
    return {
      revisionId,
      lookup: { id: lookupId, ...lookup, edits },
      expired: false,
    };
  } catch (error) {
    if (isLookupExpired(error)) {
      return { revisionId, lookup: null, expired: true };
    }
    throw error;
  }
}

export const meta: Route.MetaFunction = () => [
  { title: "같은 사람의 다른 편집 - 큼온 위키" },
];

/**
 * 판 하나에서 시작해 같은 사람이 다른 문서에 한 편집을 본다(관리자 전용).
 *
 * 문서별 가명이 지키는 것을 관리자에게 한해 푸는 화면이다. 그래서 사유를 먼저 받고, 조회 사실이
 * 공개 기록에 남는다는 것을 조회 전에 알린다. 조회하면 10분짜리 허가가 생기고, 주소에는 사람 대신
 * 그 허가의 ID가 들어간다. 허가가 끝나기 전에는 새로 고치거나 다른 화면에 다녀와도 다시 적지 않는다.
 */
export default function AuthorEditsRoute({ loaderData }: Route.ComponentProps) {
  const { revisionId, lookup, expired } = loaderData;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const formHref = `/admin/author-edits?from=${revisionId}`;

  if (!lookup) {
    return (
      <AuthorLookupForm
        revisionId={revisionId}
        expired={expired}
        onOpened={(lookupId) =>
          navigate(`${formHref}&lookup=${lookupId}`, { replace: true })
        }
      />
    );
  }
  return (
    <AuthorEditsResult
      lookup={lookup}
      retryHref={formHref}
      onChanged={() => void revalidator.revalidate()}
    />
  );
}
