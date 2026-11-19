import { useCallback } from "react";
import { Link, replace, useRevalidator } from "react-router";

import type { WikiShellHandle } from "./gate";
import type { Route } from "./+types/page";
import { LinkButton } from "~/shared/components/link-button";
import { positiveInt, titleFromParams } from "./title-param";
import { PageAdminMenu } from "~/features/admin";
import { withVerifiedMember } from "~/features/auth";
import { AddAliasButton } from "~/features/editor";
import { WikiImage } from "~/features/images";
import { pageHref } from "~/features/markup";
import {
  canAddAlias,
  getPageView,
  PageArticle,
  redirectsHere,
  type MissingPage,
} from "~/features/pages";

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

  if (!view.found) return <Missing view={view} />;
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
        ) : null
      }
    />
  );
}

/** 없는 문서. 빨간 링크를 눌러 들어오는 곳이라, 바로 만들 수 있게 한다. */
function Missing({ view }: { view: MissingPage }) {
  return (
    <article>
      <h1 className="mb-4 border-b pb-3 text-3xl leading-10 font-bold">
        {view.title}
      </h1>
      <p className="text-muted-foreground">이 문서는 아직 없습니다.</p>
      {view.title && view.validTitle && view.canEdit ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <LinkButton to={pageHref(view.title, "edit")}>
            이 문서 만들기
          </LinkButton>
          {/* 줄임말·옛 이름처럼 이미 있는 문서의 다른 이름이라면 넘겨주기로 만든다. */}
          <LinkButton
            variant="outline"
            to={`${pageHref(view.title, "edit")}?as=redirect`}
          >
            다른 문서로 넘겨주기
          </LinkButton>
        </div>
      ) : null}
      {view.backlinks.length > 0 ? (
        <section className="mt-8 text-sm">
          <h2 className="mb-2 font-semibold">이 문서를 가리키는 문서</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {view.backlinks.map((link) => (
              <li key={link.title}>
                <Link
                  to={pageHref(link.title)}
                  className="text-primary hover:underline"
                >
                  {link.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
