import type { Route } from "./+types/recent-discussions";
import { withVerifiedMember } from "~/features/auth";
import { DiscussionList, listRecentDiscussions } from "~/features/discussions";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  return {
    discussions: await withVerifiedMember(request, listRecentDiscussions),
  };
}

export const meta: Route.MetaFunction = () => [
  { title: "최근 토론 - 큼온 위키" },
];

/** 위키 전체의 최근 토론. 최근 변경처럼 모든 문서의 토론을 최근 활동순으로 보인다. */
export default function RecentDiscussionsRoute({
  loaderData,
}: Route.ComponentProps) {
  return (
    <div>
      <h1 className="mb-4 border-b pb-3 text-2xl font-bold">최근 토론</h1>
      <DiscussionList
        discussions={loaderData.discussions}
        defaultFilter="all"
      />
    </div>
  );
}
