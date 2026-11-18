import { Link } from "react-router";

import { SHELL_WIDTH } from "./shell-width";
import { pageHref } from "~/features/markup";
import { cn } from "~/shared/lib/utils";

const LINK = "hover:text-foreground hover:underline";

/**
 * 모든 화면 아래의 띠: 이용 안내와 도움말, KMLA Online으로 가는 길.
 *
 * 운영 문서는 위키 문서라 관리자가 위키에서 고친다. 아직 없는 문서도 링크는 그대로 둔다(누르면 없는
 * 문서 화면이 나온다). 오른쪽 아래의 맨 위·아래 단추에 가리지 않게 오른쪽을 비운다. 아주 넓은 화면에서는
 * 단추가 바닥글 바깥에 있으므로 비우지 않는다(바닥글 폭 81rem에 양옆 단추 자리를 더한 90rem부터).
 */
export function SiteFooter() {
  return (
    <footer className="print:hidden">
      <div
        className={cn(
          "mx-auto flex flex-col gap-2 border-t py-6 pr-16 pl-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between min-[90rem]:pr-4",
          SHELL_WIDTH,
        )}
      >
        <p>큼온 위키 · 민족사관고등학교 위키</p>
        <nav aria-label="사이트 안내">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 coarse:gap-y-2">
            <li>
              <Link to={pageHref("위키:이용 안내")} className={LINK}>
                이용 안내
              </Link>
            </li>
            <li>
              <Link to={pageHref("위키:편집 도움말")} className={LINK}>
                편집 도움말
              </Link>
            </li>
            <li>
              <Link to="/log" className={LINK}>
                관리 기록
              </Link>
            </li>
            <li>
              <a
                href="https://kmla.online"
                target="_blank"
                rel="noreferrer"
                className={LINK}
              >
                KMLA Online
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
