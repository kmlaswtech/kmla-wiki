import { Link } from "react-router";

import type { WikiNotification } from "../model/types";
import { postHref, topicHref } from "~/features/discussions";
import { pageHref } from "~/features/markup";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";

/** 알림 목록, 최근 것부터. 읽지 않은 알림은 점과 굵은 글씨로 보인다. */
export function NotificationList({
  notifications,
}: {
  notifications: readonly WikiNotification[];
}) {
  if (notifications.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground">
        최근 30일 동안 온 알림이 없습니다.
      </p>
    );
  }
  return (
    <ul className="divide-y text-sm">
      {notifications.map((item) => (
        <li key={notificationKey(item)} className="flex gap-3 py-3">
          <span
            aria-hidden
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              item.unread ? "bg-destructive" : "bg-transparent",
            )}
          />
          <div className="min-w-0 flex-1">
            <p className={cn("break-words", item.unread && "font-medium")}>
              {item.unread ? <span className="sr-only">새 알림: </span> : null}
              <NotificationText item={item} />
            </p>
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-muted-foreground">
              {item.reason === "edit" ? null : (
                <Link to={pageHref(item.pageTitle)} className="hover:underline">
                  {item.pageTitle}
                </Link>
              )}
              <span className="font-mono text-xs leading-5">
                {item.authorName}
              </span>
              <RelativeTime value={item.lastAt} />
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function notificationKey(item: WikiNotification): string {
  return item.reason === "edit"
    ? `edit:${item.pageTitle}`
    : `topic:${item.discussionId}`;
}

function NotificationText({ item }: { item: WikiNotification }) {
  if (item.reason === "edit") {
    return (
      <>
        <Link to={editHref(item)} className="text-primary hover:underline">
          {item.pageTitle}
        </Link>
        {` 문서에 새 편집이 ${item.newCount}개 있습니다.`}
      </>
    );
  }
  return (
    <>
      <Link
        to={
          item.firstPostId === null
            ? topicHref(item.discussionId)
            : postHref(item.discussionId, item.firstPostId)
        }
        className="text-primary hover:underline"
      >
        {item.discussionTitle}
      </Link>
      {item.reason === "reply"
        ? ` 토론에 새 글이 ${item.newCount}개 있습니다.`
        : " 토론이 즐겨찾기한 문서에 새로 열렸습니다."}
    </>
  );
}

/** 새 편집을 한 번에 보는 비교 화면. 앞 판이 없으면 기록 화면. */
function editHref(item: Extract<WikiNotification, { reason: "edit" }>): string {
  if (item.fromRevisionId === null) return pageHref(item.pageTitle, "history");
  return `${pageHref(item.pageTitle, "diff")}?from=${item.fromRevisionId}&to=${item.toRevisionId}`;
}
