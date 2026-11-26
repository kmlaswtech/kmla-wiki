import { useOutletContext } from "react-router";

import type { Route } from "./+types/edit";
import type { WikiShellHandle } from "./gate";
import { nonNegativeInt, titleFromParams } from "./title-param";
import { withVerifiedMember, type MemberStatus } from "~/features/auth";
import {
  EditScreen,
  type EditBlocked,
  type EditTarget,
} from "~/features/editor";
import { emptyDoc, findSections } from "~/features/markup";
import { canEditPage, getPageView, type ResolvedBody } from "~/features/pages";

export async function clientLoader({
  request,
  params,
}: Route.ClientLoaderArgs) {
  const title = titleFromParams(params);
  const searchParams = new URL(request.url).searchParams;
  const sectionParam = searchParams.get("section");
  // `?as=redirect`: 넘겨주기 입력으로 연다(없는 문서에서 "다른 문서로 넘겨주기").
  const asRedirect = searchParams.get("as") === "redirect";

  // 넘겨주기 문서를 고칠 때는 대상이 아니라 그 문서 자체를 연다.
  const view = await withVerifiedMember(request, () =>
    getPageView(title, { followRedirect: false }),
  );

  const empty: ResolvedBody = { templates: new Map(), existing: new Set() };
  if (!view.found) {
    const target: EditTarget = {
      title: view.title ?? title,
      baseRevisionId: null,
      baseBody: emptyDoc(),
      sectionIndex: null,
    };
    return {
      target,
      resolved: empty,
      images: new Map(),
      isNew: true,
      startAsRedirect: asRedirect,
      blocked: (view.validTitle ? null : "invalid-title") as EditBlocked | null,
    };
  }

  const body = view.revision?.body ?? emptyDoc();
  const requested = nonNegativeInt(sectionParam);
  const sectionIndex =
    requested !== null && findSections(body)[requested] ? requested : null;

  const target: EditTarget = {
    title: view.page.title,
    baseRevisionId: view.page.currentRevisionId,
    baseBody: body,
    sectionIndex,
  };
  const blocked: EditBlocked | null = canEditPage(view)
    ? null
    : view.page.deletedAt
      ? "deleted"
      : view.page.protection === "admin"
        ? "protected"
        : null;

  // 이미지 크기와 경로도 문서와 함께 왔다. 편집기가 처음부터 이미지 자리를 잡고 그린다.
  return {
    target,
    resolved: view.resolved,
    images: view.images,
    isNew: false,
    // 넘겨주기 문서는 언제나 넘겨주기 입력으로 연다(문단 편집도 없다).
    startAsRedirect:
      Boolean(body.attrs?.redirect) || (asRedirect && sectionIndex === null),
    blocked,
  };
}

/** 바깥 껍데기(`gate.tsx`)에 편집 화면임을 알린다. 폰에서 머리띠와 맨 위·아래로 단추를 비킨다. */
export const handle: WikiShellHandle = { editor: true };

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.target.title ?? ""} 편집 - 큼온 위키` }];
}

export default function EditRoute({ loaderData }: Route.ComponentProps) {
  const { target } = loaderData;
  const status = useOutletContext<MemberStatus>();
  // 다른 문서·문단·판으로 가면 화면을 새로 만든다(`EditScreen`).
  return (
    <EditScreen
      key={`${target.title}#${target.sectionIndex}@${target.baseRevisionId}`}
      {...loaderData}
      ban={status.ban}
    />
  );
}
