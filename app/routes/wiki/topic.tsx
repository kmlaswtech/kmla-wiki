import { ChevronLeft } from "lucide-react";
import {
  data,
  Link,
  redirect,
  useOutletContext,
  useRevalidator,
} from "react-router";

import type { Route } from "./+types/topic";
import { formText, positiveInt } from "./title-param";
import type { MemberStatus } from "~/features/auth";
import { withVerifiedMember } from "~/features/auth";
import {
  describeDiscussionError,
  DISCUSSION_FIELD,
  DISCUSSION_INTENT,
  DiscussionActions,
  type DiscussionActionResult,
  DiscussionComposer,
  DiscussionThread,
  findDiscussion,
  isDiscussionIntent,
  useLiveDiscussion,
  withdrawDiscussion,
  withdrawPost,
  writePost,
} from "~/features/discussions";
import { pageHref } from "~/features/markup";
import { Badge } from "~/shared/ui/badge";

export async function clientLoader({
  request,
  params,
}: Route.ClientLoaderArgs) {
  const id = positiveInt(params.id);
  if (!id) throw data(null, { status: 404 });
  const discussion = await withVerifiedMember(request, () =>
    findDiscussion(id),
  );
  if (!discussion) throw data(null, { status: 404 });
  return { discussion };
}

export async function clientAction({
  request,
  params,
}: Route.ClientActionArgs) {
  const id = positiveInt(params.id);
  if (!id) throw data(null, { status: 404 });
  const form = await request.formData();
  const intent = formText(form, DISCUSSION_FIELD.intent);
  if (!isDiscussionIntent(intent)) {
    return {
      ok: false,
      intent: null,
      error: "알 수 없는 요청입니다.",
    } satisfies DiscussionActionResult;
  }

  try {
    return await withVerifiedMember(request, async () => {
      switch (intent) {
        case DISCUSSION_INTENT.withdrawDiscussion: {
          // 거둔 토론은 볼 수 없으므로 문서의 토론 목록으로 간다.
          const pageTitle = await withdrawDiscussion(id);
          return redirect(pageHref(pageTitle, "discussion"));
        }
        case DISCUSSION_INTENT.withdrawPost: {
          const postId = positiveInt(formText(form, DISCUSSION_FIELD.postId));
          if (!postId) throw data(null, { status: 400 });
          await withdrawPost(postId);
          break;
        }
        default:
          await writePost(
            intent,
            id,
            formText(form, DISCUSSION_FIELD.body),
            form.get(DISCUSSION_FIELD.asAdmin) === "on",
          );
      }
      return { ok: true, intent } satisfies DiscussionActionResult;
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    return {
      ok: false,
      intent,
      error: describeDiscussionError(error),
    } satisfies DiscussionActionResult;
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const discussion = loaderData?.discussion;
  return [
    {
      title: discussion
        ? `${discussion.title} - ${discussion.pageTitle} 토론 - 큼온 위키`
        : "토론 - 큼온 위키",
    },
  ];
}

export default function TopicRoute({ loaderData }: Route.ComponentProps) {
  const { discussion } = loaderData;
  const status = useOutletContext<MemberStatus>();
  const revalidator = useRevalidator();
  const refresh = () => void revalidator.revalidate();
  // 다른 사람의 새 글, 닫기, 숨김을 5초 안에 보인다.
  useLiveDiscussion(discussion.id, discussion.version);
  const canWrite = status.ban === null && !discussion.deleted;

  return (
    <div>
      <header className="mb-4 border-b pb-3">
        <Link
          to={pageHref(discussion.pageTitle, "discussion")}
          className="mb-1 flex w-fit items-center gap-0.5 text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {discussion.pageTitle} 토론
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="flex min-w-0 flex-wrap items-center gap-2 text-2xl font-bold break-words">
            {discussion.title}
            <Badge variant={discussion.isOpen ? "default" : "outline"}>
              {discussion.isOpen ? "열림" : "닫힘"}
            </Badge>
          </h1>
          <DiscussionActions
            discussion={discussion}
            isAdmin={status.isAdmin}
            canWrite={canWrite}
            onAdminDone={refresh}
          />
        </div>
        {discussion.revisionId !== null ? (
          <p className="mt-1 text-sm text-muted-foreground">
            <Link
              to={`${pageHref(discussion.pageTitle)}?rev=${discussion.revisionId}`}
              className="text-primary tabular-nums hover:underline"
            >
              r{discussion.revisionId}
            </Link>{" "}
            판에 붙은 토론
          </p>
        ) : null}
      </header>

      {discussion.deleted ? (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
          지운 토론입니다. 관리자에게만 보입니다.
        </p>
      ) : null}

      <DiscussionThread
        posts={discussion.posts}
        isAdmin={status.isAdmin}
        canWrite={canWrite}
        onAdminDone={refresh}
      />

      {canWrite ? (
        <DiscussionComposer discussion={discussion} isAdmin={status.isAdmin} />
      ) : status.ban ? (
        <p className="mt-6 border-t pt-4 text-sm text-muted-foreground">
          차단 기간에는 토론에 글을 쓸 수 없습니다.
        </p>
      ) : null}
    </div>
  );
}
