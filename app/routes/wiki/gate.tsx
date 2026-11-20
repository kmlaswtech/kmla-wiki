import {
  Outlet,
  PrefetchPageLinks,
  redirect,
  useMatches,
  useNavigation,
} from "react-router";

import type { Route } from "./+types/gate";
import { loadMemberStatus, loginHref, pathOf } from "~/features/auth";
import { pageHref } from "~/features/markup";
import { RecentChangesPanel, useRecentChangesPanel } from "~/features/pages";
import {
  SHELL_WIDTH,
  ScrollButtons,
  SiteFooter,
  SiteHeader,
} from "~/features/shell";
import { useAfterIdle } from "~/shared/hooks/use-after-idle";
import { cn } from "~/shared/lib/utils";

/** 곁의 최근 변경을 읽는 자리(`routes.ts`, `recent-panel.ts`). */
const RECENT_PANEL_PATH = "/_panel/recent";

/**
 * 어느 화면에서든 곧 갈 일이 많은 화면. 문서 링크를 누르거나 검색창에서 Enter를 칠 때다. 이 라우트의
 * 코드를 미리 받아, 처음 갈 때 코드 파일을 차례로 받는 시간을 없앤다. 문서 제목은 아무것이나 된다.
 * 데이터는 미리 읽지 않는다(`clientLoader`가 있는 라우트는 React Router가 읽지 않는다). 첫 화면의
 * 요청과 겹치지 않게 브라우저가 한가해진 뒤에 받는다.
 */
const PREFETCH_PAGES = [pageHref("_"), "/search"];

/** 본문과 최근 변경이 함께 쓰는 상자 모양. 폰에서는 상자 없이 꽉 채운다. */
const BOX = "sm:rounded-lg sm:border sm:border-surface-border sm:shadow-xs";

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
  /** 문서를 읽는 화면이다. 포커스가 없을 때 Tab이 검색창으로 간다. */
  reading?: boolean;
}

export default function WikiLayout({ loaderData }: Route.ComponentProps) {
  const navigation = useNavigation();
  // 편집 화면에서는 폰의 머리띠를 위에 붙이지 않고(툴바와 키보드에 자리를 내준다), 폰에서는 맨
  // 위·아래로 단추를 두지 않는다(편집 요약 칸과 저장 단추를 가린다).
  const handles = useMatches().map(
    (match) => match.handle as WikiShellHandle | undefined,
  );
  const editing = handles.some((handle) => handle?.editor);
  const reading = handles.some((handle) => handle?.reading);

  const recentChanges = useRecentChangesPanel(RECENT_PANEL_PATH);
  const idle = useAfterIdle();

  return (
    <div className="flex min-h-dvh flex-col">
      {navigation.state === "loading" ? (
        <div className="fixed inset-x-0 top-0 z-30 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 animate-navigation-progress bg-primary" />
        </div>
      ) : null}
      <SiteHeader
        status={loaderData}
        stickyOnNarrow={!editing}
        tabToSearch={reading}
      />
      {loaderData.ban ? (
        <p className="border-b bg-destructive/10 px-4 py-2 text-center text-sm">
          편집이 차단된 상태입니다. 열람은 그대로 할 수 있습니다. 자세한 내용은{" "}
          <a href="/me" className="underline">
            내 정보
          </a>
          에서 볼 수 있습니다.
        </p>
      ) : null}
      {/* 본문과 곁 칸은 바깥(`canvas`) 위에 뜬 상자다. 면과 테두리는 테마 토큰(`surface`,
       * `panel`)이 정한다. 최근 변경은 넓은 화면(xl)에서 본문 곁에, 그보다 좁으면 본문 아래에 둔다. */}
      <div className="flex-1 sm:px-4 sm:py-4">
        <div
          className={cn(
            "mx-auto flex flex-col gap-4 xl:flex-row xl:items-start",
            SHELL_WIDTH,
          )}
        >
          <main className={cn("min-w-0 flex-1 bg-surface px-4 py-6", BOX)}>
            <Outlet context={loaderData} />
          </main>
          <RecentChangesPanel
            changes={recentChanges}
            className={cn(
              "bg-panel px-4 py-4 xl:sticky xl:top-[calc(var(--site-header-height)+1rem)] xl:w-64 xl:shrink-0",
              BOX,
              // 좁은 화면의 편집 화면에서는 글 아래에 목록이 붙으면 저장 단추를 찾기 어렵다.
              editing && "max-xl:hidden",
            )}
          />
        </div>
      </div>
      <SiteFooter />
      {idle
        ? PREFETCH_PAGES.map((page) => (
            <PrefetchPageLinks key={page} page={page} />
          ))
        : null}
      <ScrollButtons className={editing ? "max-sm:hidden" : undefined} />
    </div>
  );
}
