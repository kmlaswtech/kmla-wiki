import {
  History,
  LayoutList,
  Menu,
  ShieldAlert,
  Shuffle,
  User,
  type LucideIcon,
} from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Link, NavLink } from "react-router";

import { SearchBox } from "./search-box";
import { SHELL_WIDTH } from "./shell-width";
import type { MemberStatus } from "~/features/auth";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

// 높이를 고정해 글자 링크와 아이콘 링크의 hover 면 높이를 맞춘다(패딩으로 주면 아이콘 쪽이 4px 낮다).
const NAV_LINK =
  "inline-flex h-7 items-center rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground coarse:h-9 coarse:px-2.5";

/**
 * 모든 화면 위의 띠: 대문, 검색, 최근 변경, 특수 기능, 아무 문서, 내 정보.
 *
 * `stickyOnNarrow`를 끄면 좁은 화면에서는 위에 붙지 않고 본문과 함께 올라간다. 편집 화면이 쓴다.
 * 폰에서는 편집기 툴바와 키보드까지 겹치면 글을 쓸 자리가 거의 남지 않는다.
 */
export function SiteHeader({
  status,
  stickyOnNarrow = true,
}: {
  status: MemberStatus;
  stickyOnNarrow?: boolean;
}) {
  const header = useRef<HTMLElement>(null);

  // 머리띠 높이를 `--site-header-height`로 알린다(기본값은 app.css). `#주소` 이동 여백과 편집기
  // 툴바의 고정 위치가 이 값을 쓴다. 손가락으로 쓰는 화면에서는 단추가 커져 높이가 달라진다. 위에
  // 붙지 않을 때는 가리는 것이 없으므로 0이다.
  //
  // 레이아웃 효과로 처음 높이를 곧바로 적는다. `#주소`로 들어온 첫 화면에서 스크롤 복원
  // (`ScrollRestoration`, 이 뒤에 도는 레이아웃 효과)이 대상으로 옮겨 가기 전에 값이 있어야 한다.
  useLayoutEffect(() => {
    const element = header.current;
    if (!element) return;
    const root = window.document.documentElement;
    // 폭만 바뀌어도(창 크기 조절) 관찰이 불리므로, 높이가 그대로면 문서 전체에 걸린 변수를 다시
    // 쓰지 않는다.
    let current = -1;
    const setHeight = (height: number) => {
      const pinned =
        stickyOnNarrow ||
        window.getComputedStyle(element).position === "sticky";
      const rounded = pinned ? Math.round(height) : 0;
      if (rounded === current) return;
      current = rounded;
      root.style.setProperty("--site-header-height", `${rounded}px`);
    };
    setHeight(element.offsetHeight);
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize[0]?.blockSize;
      if (height !== undefined) setHeight(height);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--site-header-height");
    };
  }, [stickyOnNarrow]);

  return (
    <header
      ref={header}
      className={cn(
        "sticky top-0 z-20 border-b bg-background/95 backdrop-blur",
        !stickyOnNarrow && "max-sm:static",
      )}
    >
      {/* 폰에서도 한 줄이다. 검색창은 늘 보이게 두고, 둘러보기 메뉴만 `☰` 하나로 접는다. */}
      <div
        className={cn(
          "mx-auto flex items-center gap-x-2 px-4 py-2.5 sm:gap-x-3",
          SHELL_WIDTH,
        )}
      >
        <Link to="/" className="text-lg font-bold whitespace-nowrap">
          큼온 위키
        </Link>

        <SearchBox className="min-w-0 flex-1" />

        <NavMenu status={status} />

        <nav
          aria-label="둘러보기"
          className="flex items-center gap-0.5 max-sm:hidden"
        >
          {navItems(status).map(({ to, label, icon: Icon, iconOnWide }) => (
            <NavLink
              key={to}
              to={to}
              aria-label={iconOnWide ? label : undefined}
              className={({ isActive }) =>
                cn(NAV_LINK, isActive && "text-foreground")
              }
            >
              {iconOnWide ? <Icon className="size-4" aria-hidden /> : label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** 넓은 화면의 머리띠에서는 아이콘만 보인다. */
  iconOnWide?: boolean;
}

/** 둘러보기 항목. 넓은 화면의 머리띠와 좁은 화면의 `☰` 메뉴가 함께 쓴다. */
function navItems(status: MemberStatus): NavItem[] {
  return [
    { to: "/recent", label: "최근 변경", icon: History },
    { to: "/special", label: "특수 기능", icon: LayoutList },
    { to: "/random", label: "아무 문서", icon: Shuffle, iconOnWide: true },
    ...(status.isAdmin
      ? [{ to: "/admin", label: "관리", icon: ShieldAlert }]
      : []),
    { to: "/me", label: "내 정보", icon: User, iconOnWide: true },
  ];
}

/** 좁은 화면의 둘러보기 메뉴. 넓은 화면에서는 같은 항목을 머리띠에 펼쳐 둔다. */
function NavMenu({ status }: { status: MemberStatus }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            // 옆의 검색창·검색 단추와 높이를 맞춘다(`SearchBox`).
            className="shrink-0 sm:hidden coarse:size-9"
            aria-label="둘러보기 메뉴"
          />
        }
      >
        <Menu aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        {navItems(status).map(({ to, label, icon: Icon }) => (
          <DropdownMenuItem key={to} render={<Link to={to} />}>
            <Icon aria-hidden />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
