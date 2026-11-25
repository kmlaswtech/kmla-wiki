import { useState } from "react";
import {
  data,
  Link,
  redirect,
  useNavigate,
  useRevalidator,
} from "react-router";

import type { Route } from "./+types/history";
import { formText, positiveInt, titleFromParams } from "./title-param";
import { RevisionAdminMenu } from "~/features/admin";
import { withVerifiedMember } from "~/features/auth";
import { getRevisionDiscussionCounts } from "~/features/discussions";
import { pageHref } from "~/features/markup";
import {
  canEditPage,
  describeWriteError,
  getMyPseudonym,
  getPageView,
  listHistory,
  REVERT_FIELD,
  revertPage,
  RevertDialog,
  type RevertActionError,
  RevisionList,
} from "~/features/pages";
import { ReportButton } from "~/features/reports";
import { PageNav } from "~/shared/components/page-nav";
import { keysetHrefs, readPageCursor } from "~/shared/lib/keyset";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";

export async function clientLoader({
  request,
  params,
}: Route.ClientLoaderArgs) {
  const title = titleFromParams(params);
  const cursor = readPageCursor(new URL(request.url).searchParams);

  return withVerifiedMember(request, async () => {
    const view = await getPageView(title, { followRedirect: false });
    if (!view.found) throw data(null, { status: 404 });

    const [history, myPseudonym, discussionCounts] = await Promise.all([
      listHistory(view.page.id, cursor),
      getMyPseudonym(view.page.id),
      getRevisionDiscussionCounts(view.page.id),
    ]);
    return {
      title: view.page.title,
      currentRevisionId: view.page.currentRevisionId,
      canRevert: canEditPage(view),
      // 관리자는 방패 메뉴로 직접 조치한다. 차단된 사람은 신고도 할 수 없다(서버도 막는다).
      canReport: view.canEdit && !view.isAdmin,
      isAdmin: view.isAdmin,
      // 판에 토론을 붙여 열 수 있는가. 차단된 회원과 삭제된 문서는 안 된다.
      canDiscuss: view.canEdit && view.page.deletedAt === null,
      revisions: history.items,
      newer: history.newer,
      older: history.older,
      isFirst: cursor.kind === "first",
      myPseudonym,
      discussionCounts,
    };
  });
}

/**
 * 되돌리기. 지정한 판의 내용으로 새 판을 만든다.
 *
 * 요약은 DB가 "r123 판으로 되돌림"을 앞에 붙이므로, 사용자가 적은 사유만 넘긴다.
 */
export async function clientAction({
  request,
  params,
}: Route.ClientActionArgs) {
  const form = await request.formData();
  const revisionId = positiveInt(formText(form, REVERT_FIELD.revisionId));
  if (!revisionId)
    return data(
      { error: "되돌릴 판을 찾을 수 없습니다." } satisfies RevertActionError,
      { status: 400 },
    );

  try {
    await withVerifiedMember(request, () =>
      revertPage(revisionId, formText(form, REVERT_FIELD.summary).trim()),
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      { error: describeWriteError(error) } satisfies RevertActionError,
      { status: 400 },
    );
  }
  return redirect(pageHref(titleFromParams(params)));
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.title ?? ""} 기록 - 큼온 위키` }];
}

export default function HistoryRoute({ loaderData }: Route.ComponentProps) {
  const {
    title,
    revisions,
    myPseudonym,
    canRevert,
    canReport,
    isAdmin,
    canDiscuss,
    discussionCounts,
    currentRevisionId,
    newer,
    older,
    isFirst,
  } = loaderData;
  const discussionHref = pageHref(title, "discussion");
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const historyHref = pageHref(title, "history");
  const hrefs = keysetHrefs(historyHref, { newer, older });

  // 비교할 두 판. 처음에는 최신 판과 그 앞 판이다.
  const [compareFrom, setCompareFrom] = useState(revisions[1]?.id ?? null);
  const [compareTo, setCompareTo] = useState(revisions[0]?.id ?? null);
  const [revertTarget, setRevertTarget] = useState<number | null>(null);

  const canCompare =
    compareFrom !== null && compareTo !== null && compareFrom !== compareTo;

  return (
    <div>
      <header className="mb-4 border-b pb-3">
        <h1 className="text-2xl font-bold">
          <Link to={pageHref(title)} className="hover:underline">
            {title}
          </Link>{" "}
          <span className="font-normal text-muted-foreground">기록</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          편집자 가명은 문서마다 다릅니다.
        </p>
      </header>

      {revisions.length > 1 ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canCompare}
            onClick={() => {
              if (!canCompare) return;
              // 어느 칸에서 골랐든 앞 판이 `from`이 되게 맞춘다.
              const from = Math.min(compareFrom, compareTo);
              const to = Math.max(compareFrom, compareTo);
              void navigate(`${pageHref(title, "diff")}?from=${from}&to=${to}`);
            }}
          >
            선택한 두 판 비교
          </Button>
          <span>왼쪽은 이전 판, 오른쪽은 이후 판을 선택합니다.</span>
        </div>
      ) : null}

      <RevisionList
        revisions={revisions}
        pageTitle={() => title}
        myPseudonym={myPseudonym}
        leading={
          revisions.length > 1
            ? (revision) => {
                // 숨긴 판은 관리자만 본문을 볼 수 있다.
                const disabled = revision.hiddenAt !== null && !isAdmin;
                return (
                  <span className="flex shrink-0 items-center gap-1">
                    <input
                      type="radio"
                      name="compare-from"
                      aria-label={`r${revision.id}을 이전 판으로`}
                      checked={compareFrom === revision.id}
                      disabled={disabled}
                      onChange={() => setCompareFrom(revision.id)}
                      className="size-4 accent-primary coarse:size-5"
                    />
                    <input
                      type="radio"
                      name="compare-to"
                      aria-label={`r${revision.id}을 이후 판으로`}
                      checked={compareTo === revision.id}
                      disabled={disabled}
                      onChange={() => setCompareTo(revision.id)}
                      className="size-4 accent-primary coarse:size-5"
                    />
                  </span>
                );
              }
            : undefined
        }
        afterAuthor={(revision) => {
          const count = discussionCounts.get(revision.id);
          return count ? (
            <Badge
              variant="outline"
              render={<Link to={`${discussionHref}?rev=${revision.id}`} />}
            >
              토론 {count}
            </Badge>
          ) : null;
        }}
        actions={(revision) => (
          <>
            {canDiscuss && !revision.hiddenAt ? (
              <Link
                to={`${discussionHref}?rev=${revision.id}&new`}
                className="rounded px-1.5 py-0.5 text-primary hover:bg-muted"
              >
                토론
              </Link>
            ) : null}
            {canRevert &&
            revision.id !== currentRevisionId &&
            !revision.hiddenAt ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => setRevertTarget(revision.id)}
              >
                이 판으로 되돌리기
              </Button>
            ) : null}
            {canReport && !revision.hiddenAt ? (
              <ReportButton
                target={{ kind: "revision", id: revision.id, pageTitle: title }}
              />
            ) : null}
            {isAdmin ? (
              <RevisionAdminMenu
                revision={revision}
                pageTitle={title}
                isCurrent={revision.id === currentRevisionId}
                onDone={() => void revalidator.revalidate()}
              />
            ) : null}
          </>
        )}
      />

      <PageNav
        first={isFirst ? null : historyHref}
        prev={hrefs.newer}
        next={hrefs.older}
      />

      <RevertDialog
        key={revertTarget ?? "closed"}
        title={title}
        revisionId={revertTarget}
        currentRevisionId={currentRevisionId}
        onClose={() => setRevertTarget(null)}
      />
    </div>
  );
}
