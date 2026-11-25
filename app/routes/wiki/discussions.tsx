import { Plus } from "lucide-react";
import { useState } from "react";
import { data, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/discussions";
import { formText, positiveInt, titleFromParams } from "./title-param";
import { withVerifiedMember } from "~/features/auth";
import {
  describeDiscussionError,
  DISCUSSION_FIELD,
  DiscussionList,
  listPageDiscussions,
  NewDiscussionForm,
  openDiscussion,
  topicHref,
} from "~/features/discussions";
import { pageHref } from "~/features/markup";
import { getPageView } from "~/features/pages";
import { Button } from "~/shared/ui/button";

export async function clientLoader({
  request,
  params,
}: Route.ClientLoaderArgs) {
  const title = titleFromParams(params);
  const url = new URL(request.url);

  return withVerifiedMember(request, async () => {
    const view = await getPageView(title, { followRedirect: false });
    if (!view.found) throw data(null, { status: 404 });
    return {
      title: view.page.title,
      pageId: view.page.id,
      // 차단된 회원은 쓸 수 없다. 삭제된 문서에는 아무도 쓸 수 없다(서버도 막는다).
      canWrite: view.canEdit && view.page.deletedAt === null,
      isAdmin: view.isAdmin,
      discussions: await listPageDiscussions(view.page.id),
      // 기록 화면의 "토론"·판별 토론 수에서 온다. 그 판의 토론만 보이고, 새 토론을 그 판에 붙인다.
      revisionId: positiveInt(url.searchParams.get("rev")) ?? null,
      showNew: url.searchParams.has("new"),
    };
  });
}

export async function clientAction({
  request,
  params,
}: Route.ClientActionArgs) {
  const form = await request.formData();
  const title = titleFromParams(params);
  try {
    const id = await withVerifiedMember(request, async () => {
      const view = await getPageView(title, { followRedirect: false });
      if (!view.found) throw data(null, { status: 404 });
      return openDiscussion({
        pageId: view.page.id,
        title: formText(form, DISCUSSION_FIELD.title),
        body: formText(form, DISCUSSION_FIELD.body),
        revisionId:
          positiveInt(formText(form, DISCUSSION_FIELD.revisionId)) ?? null,
        asAdmin: form.get(DISCUSSION_FIELD.asAdmin) === "on",
      });
    });
    return redirect(topicHref(id));
  } catch (error) {
    if (error instanceof Response) throw error;
    return data({ error: describeDiscussionError(error) }, { status: 400 });
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.title ?? ""} 토론 - 큼온 위키` }];
}

export default function DiscussionsRoute({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { title, canWrite, isAdmin, discussions, revisionId } = loaderData;
  const pending = useNavigation().state === "submitting";
  const [showNew, setShowNew] = useState(loaderData.showNew);

  const listHref = pageHref(title, "discussion");
  const revisionHref = (id: number) => `${pageHref(title)}?rev=${id}`;
  const shown =
    revisionId === null
      ? discussions
      : discussions.filter((row) => row.revisionId === revisionId);

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold">
            <Link to={pageHref(title)} className="hover:underline">
              {title}
            </Link>{" "}
            <span className="font-normal text-muted-foreground">토론</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            이 문서를 어떻게 쓸지 이야기하는 곳입니다. 이름은 이 문서에서의
            가명으로 남습니다.
          </p>
        </div>
        {canWrite && !showNew ? (
          <Button type="button" size="sm" onClick={() => setShowNew(true)}>
            <Plus />새 토론
          </Button>
        ) : null}
      </header>

      {canWrite && showNew ? (
        <NewDiscussionForm
          revisionId={revisionId}
          revisionHref={revisionHref}
          unpinHref={`${listHref}?new`}
          isAdmin={isAdmin}
          pending={pending}
          error={actionData?.error ?? null}
          onCancel={() => setShowNew(false)}
        />
      ) : null}

      {revisionId !== null ? (
        <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Link
            to={revisionHref(revisionId)}
            className="text-primary tabular-nums hover:underline"
          >
            r{revisionId}
          </Link>{" "}
          판에 붙은 토론만 보고 있습니다.{" "}
          <Link to={listHref} className="text-primary hover:underline">
            모든 토론 보기
          </Link>
        </p>
      ) : null}

      <DiscussionList discussions={shown} revisionHref={revisionHref} />
    </div>
  );
}
