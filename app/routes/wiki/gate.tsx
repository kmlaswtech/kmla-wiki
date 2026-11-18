import { Outlet, redirect, useMatches, useNavigation } from "react-router";

import type { Route } from "./+types/gate";
import { loadMemberStatus, loginHref, pathOf } from "~/features/auth";
import { ScrollButtons, SiteFooter, SiteHeader } from "~/features/shell";

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
       * 다크는 바깥과 본문이 같은 바탕이라 테두리도 지운다. */}
      <div className="flex-1 sm:px-4 sm:py-4">
        <main className="mx-auto w-full max-w-5xl bg-background px-4 py-6 sm:rounded-lg sm:border sm:shadow-xs dark:border-transparent dark:shadow-none">
          <Outlet context={loaderData} />
        </main>
      </div>
      <SiteFooter />
      <ScrollButtons className={editing ? "max-sm:hidden" : undefined} />
    </div>
  );
}
