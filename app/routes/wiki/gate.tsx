import { useEffect, useRef } from "react";
import {
  Outlet,
  redirect,
  useFetcher,
  useLocation,
  useMatches,
  useNavigation,
} from "react-router";

import type { Route } from "./+types/gate";
import type { clientLoader as recentLoader } from "./recent";
import { loadMemberStatus, loginHref, pathOf } from "~/features/auth";
import { RecentChangesPanel } from "~/features/pages";
import {
  SHELL_WIDTH,
  ScrollButtons,
  SiteFooter,
  SiteHeader,
} from "~/features/shell";
import { cn } from "~/shared/lib/utils";

/** 곁의 최근 변경을 다시 읽는 최소 간격. */
const RECENT_REFRESH_MS = 30_000;

/** 본문과 최근 변경이 함께 쓰는 상자. 폰에서는 상자 없이 꽉 채운다. */
const BOX =
  "bg-background sm:rounded-lg sm:border sm:shadow-xs dark:border-transparent dark:shadow-none";

/**
 * 위키 화면 전체의 바깥 껍데기이자 단 하나의 입구 검사.
 *
 * 회원 확인이 없으면 DB가 모든 읽기에 빈 결과를 돌려준다. 그대로 들여보내면 "문서가 없다"로 보이므로
 * 여기서 로그인 화면으로 갈라 보낸다. 실제 권한 판정은 DB가 하고, 여기는 안내다.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const status = await loadMemberStatus();
  if (!status) throw redirect(loginHref(pathOf(request)));
  if (!status.verified) {
    throw redirect(
      loginHref(pathOf(request), status.isMember ? "expired" : "not-member"),
    );
  }
  return status;
}

/**
 * 첫 진입에만 돈다. 화면을 옮길 때마다 상태를 다시 읽지 않는다. 그 사이 확인 기간이 지나면 각
 * 화면의 읽기·쓰기가 권한 오류로 알려 준다(`withVerifiedMember`).
 */
export function shouldRevalidate() {
  return false;
}

/** 안쪽 화면이 `handle`로 껍데기에 알리는 것. */
export interface WikiShellHandle {
  /** 글을 쓰는 화면이다. */
  editor?: boolean;
}

export default function WikiLayout({ loaderData }: Route.ComponentProps) {
  const navigation = useNavigation();
  // 편집 화면에서는 폰의 머리띠를 위에 붙이지 않고(툴바와 키보드에 자리를 내준다), 폰에서는 맨
  // 위·아래로 단추를 두지 않는다(편집 요약 칸과 저장 단추를 가린다).
  const editing = useMatches().some(
    (match) => (match.handle as WikiShellHandle | undefined)?.editor,
  );

  // 곁의 최근 변경은 최근 변경 화면의 clientLoader를 빌려 읽는다. 처음과 화면을 옮길 때 읽되,
  // 너무 자주 읽지 않는다. 저장 같은 action 뒤에는 React Router가 알아서 다시 읽는다.
  const recent = useFetcher<typeof recentLoader>({ key: "recent-panel" });
  const { pathname } = useLocation();
  const lastLoad = useRef({ at: 0, pathname: "" });
  const loadRecent = recent.load;
  useEffect(() => {
    const last = lastLoad.current;
    if (pathname === last.pathname) return;
    if (Date.now() - last.at < RECENT_REFRESH_MS) return;
    lastLoad.current = { at: Date.now(), pathname };
    void loadRecent("/recent");
  }, [pathname, loadRecent]);

  return (
    <div className="flex min-h-dvh flex-col">
      {navigation.state === "loading" ? (
        <div className="fixed inset-x-0 top-0 z-30 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 animate-navigation-progress bg-primary" />
        </div>
      ) : null}
      <SiteHeader status={loaderData} stickyOnNarrow={!editing} />
      {loaderData.ban ? (
        <p className="border-b bg-destructive/10 px-4 py-2 text-center text-sm">
          편집이 차단된 상태입니다. 열람은 그대로 할 수 있습니다. 자세한 내용은{" "}
          <a href="/me" className="underline">
            내 정보
          </a>
          에서 볼 수 있습니다.
        </p>
      ) : null}
      {/* 라이트에서는 본문을 연회색 바깥 위의 흰 상자로 띄운다. 폰에서는 상자 없이 꽉 채운다.
       * 다크는 바깥과 본문이 같은 바탕이라 테두리도 지운다.
       * 최근 변경은 넓은 화면(xl)에서 본문 곁에, 그보다 좁으면 본문 아래에 둔다. */}
      <div className="flex-1 sm:px-4 sm:py-4">
        <div
          className={cn(
            "mx-auto flex flex-col gap-4 xl:flex-row xl:items-start",
            SHELL_WIDTH,
          )}
        >
          <main className={cn("min-w-0 flex-1 px-4 py-6", BOX)}>
            <Outlet context={loaderData} />
          </main>
          <RecentChangesPanel
            changes={recent.data?.changes}
            className={cn(
              "px-4 py-4 xl:sticky xl:top-[calc(var(--site-header-height)+1rem)] xl:w-64 xl:shrink-0",
              BOX,
              // 다크는 본문 상자를 띄우지 않으므로, 곁 칸만 카드 면으로 올려 본문과 나눈다.
              "dark:bg-card",
              // 좁은 화면의 편집 화면에서는 글 아래에 목록이 붙으면 저장 단추를 찾기 어렵다.
              editing && "max-xl:hidden",
            )}
          />
        </div>
      </div>
      <SiteFooter />
      <ScrollButtons className={editing ? "max-sm:hidden" : undefined} />
    </div>
  );
}
