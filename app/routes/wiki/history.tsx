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
import { pageHref } from "~/features/markup";
import {
  canEditPage,
  describeWriteError,
  getMyPseudonym,
  getPageView,
  HISTORY_PAGE_SIZE,
  listHistory,
  revertPage,
  RevertDialog,
  RevisionList,
} from "~/features/pages";
import { LinkButton } from "~/shared/components/link-button";
import { Button } from "~/shared/ui/button";

export async function clientLoader({
  request,
  params,
}: Route.ClientLoaderArgs) {
  const title = titleFromParams(params);
  const before = positiveInt(new URL(request.url).searchParams.get("before"));

  return withVerifiedMember(request, async () => {
    const view = await getPageView(title, { followRedirect: false });
    if (!view.found) throw data(null, { status: 404 });

    const [revisions, myPseudonym] = await Promise.all([
      listHistory(view.page.id, before),
      getMyPseudonym(view.page.id),
    ]);
    return {
      title: view.page.title,
      currentRevisionId: view.page.currentRevisionId,
      canRevert: canEditPage(view),
      isAdmin: view.isAdmin,
      revisions,
      myPseudonym,
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
  const revisionId = positiveInt(formText(form, "revisionId"));
  if (!revisionId)
    return data({ error: "되돌릴 판을 찾을 수 없습니다." }, { status: 400 });

  try {
    await withVerifiedMember(request, () =>
      revertPage(revisionId, formText(form, "summary").trim()),
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    return data({ error: describeWriteError(error) }, { status: 400 });
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
    isAdmin,
    currentRevisionId,
  } = loaderData;
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const oldest = revisions.at(-1);

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
          편집자는 이 문서에서만 쓰이는 가명으로 표시됩니다. 같은 사람도 다른
          문서에서는 다른 가명입니다.
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
            고른 두 판 비교
          </Button>
          <span>왼쪽 칸에서 이전 판, 오른쪽 칸에서 이후 판을 고릅니다.</span>
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
        actions={(revision) => (
          <>
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

      {revisions.length === HISTORY_PAGE_SIZE && oldest ? (
        <div className="mt-4 text-center">
          <LinkButton
            variant="outline"
            to={`${pageHref(title, "history")}?before=${oldest.id}`}
          >
            더 예전 기록
          </LinkButton>
        </div>
      ) : null}

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
