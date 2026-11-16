import { data, Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/move";
import { formText, titleFromParams } from "./title-param";
import { withVerifiedMember } from "~/features/auth";
import { pageHref } from "~/features/markup";
import {
  canEditPage,
  describeWriteError,
  getPageView,
  movePage,
} from "~/features/pages";
import { Button } from "~/shared/ui/button";
import { Checkbox } from "~/shared/ui/checkbox";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { Spinner } from "~/shared/ui/spinner";

export async function clientLoader({
  request,
  params,
}: Route.ClientLoaderArgs) {
  const title = titleFromParams(params);
  const view = await withVerifiedMember(request, () =>
    getPageView(title, { followRedirect: false }),
  );
  if (!view.found) throw data(null, { status: 404 });
  return {
    title: view.page.title,
    canMove: canEditPage(view),
    childCount: view.children.length,
  };
}

export async function clientAction({
  request,
  params,
}: Route.ClientActionArgs) {
  const form = await request.formData();
  const newTitle = formText(form, "newTitle");

  try {
    const moved = await withVerifiedMember(request, () =>
      movePage({
        title: titleFromParams(params),
        newTitle,
        leaveRedirect: form.get("leaveRedirect") === "on",
      }),
    );
    return redirect(pageHref(moved.title));
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      { error: describeWriteError(error), newTitle },
      { status: 400 },
    );
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.title ?? ""} 이동 - 큼온 위키` }];
}

export default function MoveRoute({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { title, canMove, childCount } = loaderData;
  const pending = useNavigation().state === "submitting";

  return (
    <div className="max-w-xl">
      <header className="mb-4 border-b pb-3">
        <h1 className="text-2xl font-bold">
          <Link to={pageHref(title)} className="hover:underline">
            {title}
          </Link>{" "}
          <span className="font-normal text-muted-foreground">이동</span>
        </h1>
      </header>

      {canMove ? (
        <Form method="post" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            문서의 이름을 바꿉니다. 판 기록은 그대로 따라갑니다. 제목은 공식
            명칭으로 쓰고, 은어나 약칭은 넘겨주기로 남겨 주세요.
            {childCount > 0
              ? ` 하위 문서 ${childCount}개는 함께 옮겨지지 않습니다.`
              : ""}
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="new-title">새 이름</Label>
            <Input
              id="new-title"
              type="text"
              name="newTitle"
              defaultValue={actionData?.newTitle ?? title}
              maxLength={100}
              required
            />
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox name="leaveRedirect" defaultChecked />옛 이름에 넘겨주기
            남기기
          </Label>
          {actionData?.error ? (
            <p role="alert" className="text-sm text-destructive">
              {actionData.error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            이동
          </Button>
        </Form>
      ) : (
        <p className="rounded-md border p-4 text-sm">
          이 문서는 이동할 수 없습니다.
        </p>
      )}
    </div>
  );
}
