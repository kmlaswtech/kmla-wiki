import { useCallback, useState } from "react";
import { replace, useRevalidator } from "react-router";

import type { WikiShellHandle } from "./gate";
import type { Route } from "./+types/page";
import { positiveInt, titleFromParams } from "./title-param";
import { usePageAdminActions } from "~/features/admin";
import { withVerifiedMember } from "~/features/auth";
import { WikiImage } from "~/features/images";
import { pageHref } from "~/features/markup";
import { WatchButton } from "~/features/notifications";
import {
  AddAliasButton,
  canAddAlias,
  getPageView,
  MissingArticle,
  PageArticle,
  redirectsHere,
  type PageMenuItem,
} from "~/features/pages";
import { ReportDialog } from "~/features/reports";

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
  if (!view.found) return <MissingArticle view={view} />;
  // 문서마다 새로 그려 메뉴와 대화상자의 상태가 다른 문서로 넘어가지 않게 한다.
  return <FoundPageView key={view.page.id} view={view} />;
}

type FoundView = Extract<
  Route.ComponentProps["loaderData"]["view"],
  { found: true }
>;

function FoundPageView({ view }: { view: FoundView }) {
  const revalidator = useRevalidator();
  const revalidate = useCallback(
    () => void revalidator.revalidate(),
    [revalidator],
  );
  const { images } = view;
  const renderImage = useCallback(
    (imageId: string, alt: string) => (
      <WikiImage info={images.get(imageId)} alt={alt} />
    ),
    [images],
  );
  const admin = usePageAdminActions({
    page: view.page,
    aliasCount: redirectsHere(view).length,
    onDone: revalidate,
  });
  const [reporting, setReporting] = useState(false);
  // 관리자는 신고하지 않고 바로 조치한다. 보고 있는 판을 신고한다(예전 판을 보는 중이면 그 판).
  const reportTarget =
    !view.isAdmin && view.canEdit && view.revision
      ? {
          kind: "revision" as const,
          id: view.revision.id,
          pageTitle: view.page.title,
        }
      : null;
  const menuItems: PageMenuItem[] = view.isAdmin
    ? admin.items
    : reportTarget
      ? [{ label: "신고", onSelect: () => setReporting(true) }]
      : [];

  return (
    <>
      <PageArticle
        view={view}
        renderImage={renderImage}
        aliasAction={
          canAddAlias(view) ? (
            <AddAliasButton title={view.page.title} onAdded={revalidate} />
          ) : null
        }
        watchAction={
          <WatchButton
            pageId={view.page.id}
            watched={view.watched}
            watchers={view.watchers}
          />
        }
        menuItems={menuItems}
      />
      {view.isAdmin ? admin.dialogs : null}
      {reportTarget ? (
        <ReportDialog
          target={reportTarget}
          open={reporting}
          onOpenChange={setReporting}
        />
      ) : null}
    </>
  );
}
