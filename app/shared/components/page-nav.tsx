import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { LinkButton } from "~/shared/components/link-button";
import { keysetHrefs, type KeysetPage } from "~/shared/lib/keyset";
import { Button } from "~/shared/ui/button";

/** 번호로 끊어 읽은 목록(`KeysetPage`)의 쪽 넘기기. 주소는 `path?before=N`, `path?after=N`이다. */
export function KeysetNav({
  path,
  page,
}: {
  path: string;
  page: Omit<KeysetPage<unknown>, "items">;
}) {
  return <PageNav {...keysetHrefs(path, page)} />;
}

/**
 * 목록의 쪽 넘기기. 주소로 쪽을 나타내서 공유와 뒤로 가기가 된다(무한 스크롤을 쓰지 않는다).
 *
 * `first`는 첫 쪽이 아닐 때만 준다. 갈 곳이 없는 단추는 자리를 지키도록 비활성으로 둔다. 앞뒤 모두
 * 없으면 아무것도 그리지 않는다.
 */
export function PageNav({
  first,
  prev,
  next,
}: {
  first?: string | null;
  prev?: string | null;
  next?: string | null;
}) {
  if (!first && !prev && !next) return null;
  return (
    <nav
      aria-label="쪽 넘기기"
      className="mt-4 flex items-center justify-center gap-2"
    >
      {first ? (
        <LinkButton variant="ghost" size="sm" to={first}>
          처음
        </LinkButton>
      ) : null}
      <StepLink to={prev}>
        <ChevronLeftIcon />
        이전
      </StepLink>
      <StepLink to={next}>
        다음
        <ChevronRightIcon />
      </StepLink>
    </nav>
  );
}

function StepLink({
  to,
  children,
}: {
  to: string | null | undefined;
  children: ReactNode;
}) {
  if (!to) {
    return (
      <Button variant="outline" size="sm" disabled>
        {children}
      </Button>
    );
  }
  return (
    <LinkButton variant="outline" size="sm" to={to}>
      {children}
    </LinkButton>
  );
}
