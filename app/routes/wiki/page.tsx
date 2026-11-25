import { useCallback } from "react";
import { replace, useRevalidator } from "react-router";

import type { WikiShellHandle } from "./gate";
import type { Route } from "./+types/page";
import { positiveInt, titleFromParams } from "./title-param";
import { PageAdminMenu } from "~/features/admin";
import { withVerifiedMember } from "~/features/auth";
import { WikiImage } from "~/features/images";
import { pageHref } from "~/features/markup";
import {
  AddAliasButton,
  canAddAlias,
  getPageView,
  MissingArticle,
  PageArticle,
  redirectsHere,
} from "~/features/pages";
import { ReportButton } from "~/features/reports";

export const handle: WikiShellHandle = { reading: true };

export async function clientLoader({
  request,
  params,
}: Route.ClientLoaderArgs) {
  const title = titleFromParams(params);
  const url = new URL(request.url);

  const view = await withVerifiedMember(request, () =>
    getPageView(title, {
      followRedirect: url.searchParams.get("redirect") !== "no",
      revisionId: positiveInt(url.searchParams.get("rev")),
    }),
  );

  // 같은 문서는 주소도 하나로 맞춘다(`/w/prism` → `/w/PRISM`). 넘겨주기를 따라온 경우는 요청한
  // 주소를 그대로 둔다.
  if (view.found && !view.redirectedFrom) {
    const canonical = pageHref(view.page.title);
    if (decodeURI(url.pathname) !== decodeURI(canonical)) {
      throw replace(`${canonical}${url.search}${url.hash}`);
    }
  }

  return { view };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const view = loaderData?.view;
  const title = view?.found ? view.page.title : view?.title;
  return [{ title: title ? `${title} - 큼온 위키` : "큼온 위키" }];
}

export default function PageRoute({ loaderData }: Route.ComponentProps) {
  const { view } = loaderData;
  const revalidator = useRevalidator();
  const images = view.found ? view.images : null;
  const renderImage = useCallback(
    (imageId: string, alt: string) => (
      <WikiImage info={images?.get(imageId)} alt={alt} />
    ),
    [images],
  );

  if (!view.found) return <MissingArticle view={view} />;
  return (
    <PageArticle
      view={view}
      renderImage={renderImage}
      aliasAction={
        canAddAlias(view) ? (
          <AddAliasButton
            title={view.page.title}
            onAdded={() => void revalidator.revalidate()}
          />
        ) : null
      }
      headerActions={
        view.isAdmin ? (
          <PageAdminMenu
            page={view.page}
            aliasCount={redirectsHere(view).length}
            onDone={() => void revalidator.revalidate()}
          />
        ) : view.canEdit && view.revision ? (
          // 보고 있는 판을 신고한다(예전 판을 보는 중이면 그 판).
          <ReportButton
            target={{
              kind: "revision",
              id: view.revision.id,
              pageTitle: view.page.title,
            }}
            size="icon-sm"
          />
        ) : null
      }
    />
  );
}
