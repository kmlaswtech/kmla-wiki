import { useCallback } from "react";

import type { WikiShellHandle } from "./gate";
import type { Route } from "./+types/home";
import { LinkButton } from "~/shared/components/link-button";
import { withVerifiedMember } from "~/features/auth";
import { WikiImage } from "~/features/images";
import { pageHref } from "~/features/markup";
import { getPageView, PageArticle } from "~/features/pages";

/** 대문으로 보여 줄 문서. 일반 문서와 같게 고칠 수 있고, 운영 시에는 관리자 보호를 건다. */
const MAIN_PAGE = "위키:대문";

export const handle: WikiShellHandle = { reading: true };

// 최근 변경은 모든 화면의 곁(또는 아래)에 있으므로 대문에 따로 두지 않는다(`gate.tsx`).
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  return {
    view: await withVerifiedMember(request, () => getPageView(MAIN_PAGE)),
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
      <p className="text-muted-foreground">
        아직 대문이 없습니다. <code>{MAIN_PAGE}</code> 문서를 만들면 여기에
        보입니다.
      </p>
      {view.canEdit ? (
        <LinkButton className="mt-4" to={pageHref(MAIN_PAGE, "edit")}>
          대문 만들기
        </LinkButton>
      ) : null}
    </section>
  );
}
