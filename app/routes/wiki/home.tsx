import { useCallback } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/home";
import { LinkButton } from "~/shared/components/link-button";
import { withVerifiedMember } from "~/features/auth";
import { resolveImages, WikiImage } from "~/features/images";
import { pageHref } from "~/features/markup";
import {
  getPageView,
  listRecentChanges,
  PageArticle,
  RevisionList,
} from "~/features/pages";

/** 대문으로 보여 줄 문서. 일반 문서와 같게 고칠 수 있고, 운영 시에는 관리자 보호를 건다. */
const MAIN_PAGE = "위키:대문";
const RECENT_COUNT = 10;

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const [view, recent] = await withVerifiedMember(request, () =>
    Promise.all([getPageView(MAIN_PAGE), listRecentChanges()]),
  );
  // 이미지 정보를 못 받아도 대문은 보여 준다.
  const images = await resolveImages(
    view.found ? (view.revision?.body ?? "") : "",
  ).catch(() => new Map<string, never>());
  return { view, images, recent: recent.slice(0, RECENT_COUNT) };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { view, images, recent } = loaderData;
  const renderImage = useCallback(
    (imageId: string, alt: string) => (
      <WikiImage info={images.get(imageId)} alt={alt} />
    ),
    [images],
  );

  return (
    <div className="space-y-10">
      {view.found ? (
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
      )}

      <section>
        <div className="mb-1 flex items-baseline justify-between border-b pb-1.5">
          <h2 className="text-xl font-bold">최근 변경</h2>
          <Link to="/recent" className="text-sm text-primary hover:underline">
            더 보기
          </Link>
        </div>
        <RevisionList
          revisions={recent}
          pageTitle={(change) => change.pageTitle}
          showPage
        />
      </section>
    </div>
  );
}
