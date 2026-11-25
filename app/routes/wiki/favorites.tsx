import type { Route } from "./+types/favorites";
import { withVerifiedMember } from "~/features/auth";
import { listWatchedPages, WatchedPageList } from "~/features/notifications";

export const meta = () => [{ title: "즐겨찾기 - 큼온 위키" }];

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  return withVerifiedMember(request, async () => ({
    pages: await listWatchedPages(),
  }));
}

export default function FavoritesRoute({ loaderData }: Route.ComponentProps) {
  return (
    <div className="max-w-2xl">
      <header className="mb-4 border-b pb-3">
        <h1 className="text-2xl font-bold">즐겨찾기</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          즐겨찾기한 문서가 편집되거나 새 토론이 열리면 알림이 옵니다. 다른
          사람은 내 즐겨찾기를 볼 수 없습니다.
        </p>
      </header>
      <WatchedPageList pages={loaderData.pages} />
    </div>
  );
}
