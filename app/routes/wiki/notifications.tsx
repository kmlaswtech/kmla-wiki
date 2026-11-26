import type { Route } from "./+types/notifications";
import { Link } from "react-router";

import { withVerifiedMember } from "~/features/auth";
import { NotificationList, readNotifications } from "~/features/notifications";

export const meta = () => [{ title: "알림 - 큼온 위키" }];

/** 알림을 읽는다. 이 화면을 열면 알림이 모두 읽음으로 바뀐다. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  return withVerifiedMember(request, async () => ({
    notifications: await readNotifications(),
  }));
}

export default function NotificationsRoute({
  loaderData,
}: Route.ComponentProps) {
  return (
    <div className="max-w-2xl">
      <header className="mb-4 border-b pb-3">
        <h1 className="text-2xl font-bold">알림</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link to="/favorites" className="text-primary hover:underline">
            즐겨찾기
          </Link>
          한 문서의 새 편집과 새 토론, 내가 글을 쓴 토론의 새 글을 알립니다.
        </p>
      </header>
      <NotificationList notifications={loaderData.notifications} />
    </div>
  );
}
