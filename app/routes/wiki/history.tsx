import { data, Link, redirect, useFetcher, useRevalidator } from "react-router";

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

/** 되돌리기. 지정한 판의 내용으로 새 판을 만든다. */
export async function clientAction({
  request,
  params,
}: Route.ClientActionArgs) {
  const form = await request.formData();
  const revisionId = positiveInt(formText(form, "revisionId"));
  if (!revisionId)
    return data({ error: "되돌릴 판을 찾을 수 없습니다." }, { status: 400 });

  try {
    await withVerifiedMember(request, () => revertPage(revisionId, ""));
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
  const fetcher = useFetcher<typeof clientAction>();
  const oldest = revisions.at(-1);

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

      {fetcher.data?.error ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {fetcher.data.error}
        </p>
      ) : null}

      <RevisionList
        revisions={revisions}
        pageTitle={() => title}
        myPseudonym={myPseudonym}
        actions={(revision) => (
          <>
            {canRevert &&
            revision.id !== currentRevisionId &&
            !revision.hiddenAt ? (
              <fetcher.Form method="post">
                <input type="hidden" name="revisionId" value={revision.id} />
                <Button
                  type="submit"
                  size="xs"
                  variant="ghost"
                  disabled={fetcher.state !== "idle"}
                >
                  이 판으로 되돌리기
                </Button>
              </fetcher.Form>
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
    </div>
  );
}
