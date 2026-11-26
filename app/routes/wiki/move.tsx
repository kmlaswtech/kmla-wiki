import { useState } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/move";
import { formText, titleFromParams } from "./title-param";
import { withVerifiedMember } from "~/features/auth";
import { pageHref, parseTitle, titleKey } from "~/features/markup";
import {
  canEditPage,
  describeWriteError,
  getPageView,
  movePage,
  redirectsHere,
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
    redirectTarget: view.page.redirectTarget,
    canMove: canEditPage(view),
    redirects: redirectsHere(view),
    linkCount: view.backlinks.filter((link) => !link.isRedirect).length,
    subpages: view.children,
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
  const { title, canMove, subpages } = loaderData;
  const pending = useNavigation().state === "submitting";
  const [newTitle, setNewTitle] = useState(actionData?.newTitle ?? title);
  const [leaveRedirect, setLeaveRedirect] = useState(true);

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
            편집 기록은 유지됩니다. 공식 명칭을 제목으로 쓰고, 은어나 약칭은
            넘겨주기로 남겨 주세요.
            {subpages.length > 0
              ? ` 하위 문서 ${subpages.length}개(${subpages.join(", ")})는 함께 옮겨지지 않습니다.`
              : ""}
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="new-title">새 제목</Label>
            <Input
              id="new-title"
              type="text"
              name="newTitle"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              maxLength={100}
              required
            />
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox
              name="leaveRedirect"
              checked={leaveRedirect}
              onCheckedChange={setLeaveRedirect}
            />
            이전 제목에 넘겨주기 남기기
          </Label>
          <MovePreview
            title={title}
            redirectTarget={loaderData.redirectTarget}
            redirects={loaderData.redirects}
            linkCount={loaderData.linkCount}
            newTitle={parseTitle(newTitle)}
            leaveRedirect={leaveRedirect}
          />
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

/** 이동하면 바뀌는 것. 서버(`move_page`)가 하는 일을 미리 보여 준다. */
function MovePreview({
  title,
  redirectTarget,
  newTitle,
  leaveRedirect,
  redirects,
  linkCount,
}: {
  title: string;
  /** 옮길 문서가 넘겨주기면 그 대상. 남기는 넘겨주기와 따라오는 넘겨주기가 이리로 간다. */
  redirectTarget: string | null;
  /** 정규화한 새 이름. 쓸 수 없는 이름이면 `null`. */
  newTitle: string | null;
  leaveRedirect: boolean;
  redirects: string[];
  linkCount: number;
}) {
  if (newTitle === null || newTitle === title) return null;
  // 대소문자·공백만 바꾸면 같은 문서라 넘겨주기와 링크는 그대로 이 문서로 온다.
  const renamed = titleKey(newTitle) !== titleKey(title);
  // 새 이름이 이 문서로 오는 넘겨주기면 서버가 그것을 지우고 그 자리로 옮긴다(내용이 있던 적이
  // 있으면 막는다).
  const replaced = renamed
    ? redirects.find((name) => titleKey(name) === titleKey(newTitle))
    : undefined;
  const destination = redirectTarget ?? "새 제목";
  const followers = renamed
    ? redirects.filter((name) => name !== replaced).length
    : 0;

  return (
    <section
      aria-label="이동 후 변경 사항"
      className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm break-keep"
    >
      <p className="font-medium">
        {title} <span aria-hidden>→</span> {newTitle}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {replaced ? (
          <li>
            기존 넘겨주기 {replaced}를 이 문서로 대체합니다. 본문을 저장한
            기록이 있으면 이동할 수 없습니다.
          </li>
        ) : null}
        {followers > 0 ? (
          <li>
            기존 넘겨주기 {followers}개를 새 제목 {destination}에 연결합니다.
          </li>
        ) : null}
        {renamed && leaveRedirect ? (
          <li>
            이전 제목으로 접속하면 새 제목 {destination}(으)로 넘어갑니다.
          </li>
        ) : null}
      </ul>
      {renamed && !leaveRedirect ? (
        <p role="alert" className="text-destructive">
          이전 주소로 문서를 열 수 없습니다.{" "}
          {linkCount > 0
            ? `이 주소를 가리키는 위키 링크 ${linkCount}개와 `
            : ""}
          외부 공유 링크에 영향을 줍니다.
        </p>
      ) : null}
    </section>
  );
}
