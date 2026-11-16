import type { Route } from "./+types/recent";
import { LinkButton } from "~/shared/components/link-button";
import { positiveInt } from "./title-param";
import { withVerifiedMember } from "~/features/auth";
import {
  HISTORY_PAGE_SIZE,
  listRecentChanges,
  RevisionList,
} from "~/features/pages";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const before = positiveInt(new URL(request.url).searchParams.get("before"));
  return {
    changes: await withVerifiedMember(request, () => listRecentChanges(before)),
  };
}

export const meta: Route.MetaFunction = () => [
  { title: "최근 변경 - 큼온 위키" },
];

export default function RecentRoute({ loaderData }: Route.ComponentProps) {
  const { changes } = loaderData;
  const oldest = changes.at(-1);

  return (
    <div>
      <h1 className="mb-4 border-b pb-3 text-2xl font-bold">최근 변경</h1>
      <RevisionList
        revisions={changes}
        pageTitle={(change) => change.pageTitle}
        showPage
      />
      {changes.length === HISTORY_PAGE_SIZE && oldest ? (
        <div className="mt-4 text-center">
          <LinkButton variant="outline" to={`/recent?before=${oldest.id}`}>
            더 예전 변경
          </LinkButton>
        </div>
      ) : null}
    </div>
  );
}
