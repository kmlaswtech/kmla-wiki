import { Shuffle, User } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, NavLink } from "react-router";

import { SearchBox } from "./search-box";
import type { MemberStatus } from "~/features/auth";
import { cn } from "~/shared/lib/utils";

const NAV_LINK =
  "rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground";

/** 모든 화면 위의 띠: 대문, 검색, 최근 변경, 특수 기능, 아무 문서, 내 정보. */
export function SiteHeader({ status }: { status: MemberStatus }) {
  const header = useRef<HTMLElement>(null);

  // 머리띠 높이를 `--site-header-height`로 알린다. `#주소` 이동 여백(app.css)과 편집기 툴바의
  // 고정 위치가 이 값을 쓴다. 좁은 화면에서는 검색창이 둘째 줄로 내려가 높이가 바뀐다.
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    const root = window.document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty(
        "--site-header-height",
        `${element.getBoundingClientRect().height}px`,
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--site-header-height");
    };
  }, []);

  return (
    <header
      ref={header}
      className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
        <Link to="/" className="text-lg font-bold whitespace-nowrap">
          큼온 위키
        </Link>

        <SearchBox className="order-last w-full sm:order-none sm:w-auto sm:flex-1" />

        <nav
          aria-label="둘러보기"
          className="ml-auto flex items-center gap-0.5"
        >
          <NavLink
            to="/recent"
            className={({ isActive }) =>
              cn(NAV_LINK, isActive && "text-foreground")
            }
          >
            최근 변경
          </NavLink>
          <NavLink
            to="/special"
            className={({ isActive }) =>
              cn(NAV_LINK, isActive && "text-foreground")
            }
          >
            특수 기능
          </NavLink>
          <Link to="/random" className={NAV_LINK} aria-label="아무 문서로">
            <Shuffle className="size-4" aria-hidden />
          </Link>
          {status.isAdmin ? (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                cn(NAV_LINK, isActive && "text-foreground")
              }
            >
              관리
            </NavLink>
          ) : null}
          <Link to="/me" className={NAV_LINK} aria-label="내 정보">
            <User className="size-4" aria-hidden />
          </Link>
        </nav>
      </div>
    </header>
  );
}
