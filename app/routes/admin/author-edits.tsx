import { data, redirect, useRevalidator } from "react-router";

import type { Route } from "./+types/author-edits";
import {
  AuthorEditsResult,
  AuthorLookupForm,
  authorEditsHref,
  findAuthorLookup,
  getAuthorLookup,
  isLookupExpired,
  listAuthorEdits,
} from "~/features/admin";
import { loadMemberStatus, withVerifiedMember } from "~/features/auth";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // 화면을 가리는 검사다. 실제 권한은 RPC가 검사한다.
  const status = await loadMemberStatus();
  if (!status?.isAdmin) throw redirect("/");

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  if (!/^\d+$/.test(from)) throw data(null, { status: 404 });
  const revisionId = Number(from);

  const lookupId = params.get("lookup");
  if (!lookupId) {
    // 이 사람에 대해 이미 연 허가가 있으면(나갔다 돌아옴, 같은 사람의 다른 판) 사유를 다시 받지 않는다.
    const open = await withVerifiedMember(request, () =>
      findAuthorLookup(revisionId),
    );
    if (open) throw redirect(authorEditsHref(revisionId, open));
    return { revisionId, lookup: null };
  }

  try {
    const [lookup, edits] = await withVerifiedMember(request, () =>
      Promise.all([getAuthorLookup(lookupId), listAuthorEdits(lookupId)]),
    );
    return { revisionId, lookup: { id: lookupId, ...lookup, edits } };
  } catch (error) {
    // 끝났거나 남의 허가거나 손으로 고친 ID다. 모두 사유를 다시 받는다.
    if (isLookupExpired(error))
      return { revisionId, lookup: "expired" as const };
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
  const { revisionId, lookup } = loaderData;
  const revalidator = useRevalidator();

  if (lookup === null || lookup === "expired") {
    return (
      <AuthorLookupForm
        revisionId={revisionId}
        expired={lookup === "expired"}
      />
    );
  }
  return (
    <AuthorEditsResult
      key={lookup.id}
      revisionId={revisionId}
      lookup={lookup}
      onChanged={() => void revalidator.revalidate()}
    />
  );
}
