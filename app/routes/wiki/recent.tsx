import type { Route } from "./+types/recent";
import { withVerifiedMember } from "~/features/auth";
import { listRecentChanges, RevisionList } from "~/features/pages";
import { PageNav } from "~/shared/components/page-nav";
import { keysetHrefs, readPageCursor } from "~/shared/lib/keyset";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const cursor = readPageCursor(new URL(request.url).searchParams);
  return {
    page: await withVerifiedMember(request, () => listRecentChanges(cursor)),
    isFirst: cursor.kind === "first",
  };
}

export const meta: Route.MetaFunction = () => [
  { title: "최근 변경 - 큼온 위키" },
];

export default function RecentRoute({ loaderData }: Route.ComponentProps) {
  const { page, isFirst } = loaderData;
  const hrefs = keysetHrefs("/recent", page);

  return (
    <div>
      <h1 className="mb-4 border-b pb-3 text-2xl font-bold">최근 변경</h1>
      <RevisionList
        revisions={page.items}
        pageTitle={(change) => change.pageTitle}
        showPage
      />
      <PageNav
        first={isFirst ? null : "/recent"}
        prev={hrefs.newer}
        next={hrefs.older}
      />
    </div>
  );
}
