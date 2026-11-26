import { useCallback } from "react";

import type { WikiShellHandle } from "./gate";
import type { Route } from "./+types/home";
import { LinkButton } from "~/shared/components/link-button";
import { withVerifiedMember } from "~/features/auth";
import { WikiImage } from "~/features/images";
import { pageHref } from "~/features/markup";
import { getPageView, MAIN_PAGE_TITLE, PageArticle } from "~/features/pages";

export const handle: WikiShellHandle = { reading: true };

// 최근 변경은 모든 화면의 곁(또는 아래)에 있으므로 대문에 따로 두지 않는다(`gate.tsx`).
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  return {
    view: await withVerifiedMember(request, () => getPageView(MAIN_PAGE_TITLE)),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { view } = loaderData;
  const images = view.found ? view.images : null;
  const renderImage = useCallback(
    (imageId: string, alt: string) => (
      <WikiImage info={images?.get(imageId)} alt={alt} />
    ),
    [images],
  );

  return view.found ? (
    <PageArticle view={view} renderImage={renderImage} />
  ) : (
    <section>
      <h1 className="mb-2 text-3xl font-bold">큼온 위키</h1>
      <p className="text-muted-foreground">아직 대문이 없습니다.</p>
      {view.canEdit ? (
        <LinkButton className="mt-4" to={pageHref(MAIN_PAGE_TITLE, "edit")}>
          대문 만들기
        </LinkButton>
      ) : null}
    </section>
  );
}
