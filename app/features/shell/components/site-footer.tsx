import { Link } from "react-router";

import { pageHref } from "~/features/markup";

const LINK = "hover:text-foreground hover:underline";

/**
 * 모든 화면 아래의 띠: 이용 안내와 도움말, KMLA Online으로 가는 길.
 *
 * 운영 문서는 위키 문서라 관리자가 위키에서 고친다. 아직 없는 문서도 링크는 그대로 둔다(누르면 없는
 * 문서 화면이 나온다). 폰에서는 오른쪽 아래의 맨 위·아래 단추에 가리지 않게 오른쪽을 비운다.
 */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={className}>
      <div className="mx-auto flex max-w-5xl flex-col gap-2 border-t px-4 py-6 text-sm text-muted-foreground max-sm:pr-16 sm:flex-row sm:items-center sm:justify-between">
        <p>큼온 위키 · 민족사관고등학교 학교생활 위키</p>
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
