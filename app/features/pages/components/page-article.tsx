import {
  ChevronRight,
  CornerDownRight,
  Ellipsis,
  Lock,
  Pencil,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link, useLocation } from "react-router";

import type { FoundPage, RedirectInfo } from "../model/types";
import { canEditPage } from "../model/view";
import {
  ancestorTitles,
  baseName,
  emptyDoc,
  pageHref,
  parseWiki,
  readSectionScroll,
  redirectPageHref,
  TableOfContents,
  titleKey,
  WikiContent,
} from "~/features/markup";
import { LinkButton } from "~/shared/components/link-button";
import { RelativeTime } from "~/shared/components/relative-time";
import { formatDateTime } from "~/shared/lib/time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

/** 문서 머리 `⋯` 메뉴의 항목 하나. 대화상자는 메뉴 바깥에 둔다(메뉴가 닫히면 안의 것이 사라진다). */
export interface PageMenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

interface PageArticleProps {
  view: FoundPage;
  /** 올린 이미지를 그리는 방법. 이미지 기능이 준다. */
  renderImage?: (imageId: string, alt: string) => ReactNode;
  /** 단추 줄 맨 앞에 따로 두는 별표(즐겨찾기). */
  watchAction?: ReactNode;
  /** `⋯` 메뉴에 이동 다음으로 넣을 항목(신고, 관리). */
  menuItems?: readonly PageMenuItem[];
  /** "다른 이름" 칸 끝에 둘 `이름 추가` 단추. 더할 수 없으면 비운다. */
  aliasAction?: ReactNode;
}

/** 문서 한 편: 경로, 제목, 안내, 목차, 본문, 하위 문서, 분류, 역링크. */
export function PageArticle({
  view,
  renderImage,
  watchAction,
  menuItems = [],
  aliasAction,
}: PageArticleProps) {
  const { page, revision, resolved } = view;
  const body = revision?.body ?? emptyDoc();
  const viewingOldRevision = revision !== null && !revision.isCurrent;
  const editable = canEditPage(view);

  const document = useMemo(
    () => parseWiki(body, { templates: resolved.templates }),
    [body, resolved.templates],
  );

  // 문단 편집 링크는 이 문서 자신의 제목에만 붙는다(틀이 넣은 제목은 `sectionIndex`가 없다).
  const sectionEditable = editable && !viewingOldRevision;
  const sectionEditHref = useCallback(
    (index: number) => `${pageHref(page.title, "edit")}?section=${index}`,
    [page.title],
  );

  // 문단 편집을 저장하고 왔으면 그 문단 제목으로 옮긴다. `ScrollRestoration`이 맨 위로 올린 뒤에
  // 돈다. 저장하며 그 문단을 지웠으면 맨 위에 둔다.
  const location = useLocation();
  const { headings } = document;
  // 한 navigation에 한 번만 옮긴다. loader가 다시 돌아 `headings`가 바뀌어도 다시 옮기지 않는다.
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    const index = readSectionScroll(location.state);
    if (index === null || scrolledFor.current === location.key) return;
    scrolledFor.current = location.key;
    const id = headings.find((heading) => heading.sectionIndex === index)?.id;
    if (id) window.document.getElementById(id)?.scrollIntoView();
    // 기록에서 지운다. 뒤로 가기·새로고침으로 돌아왔을 때 브라우저가 되살린 위치를 덮지 않게 한다.
    // React Router의 `navigate`로 지우면 loader가 다시 돌므로 history를 직접 고친다(`usr`가
    // React Router가 navigation state를 두는 자리다).
    const entry: unknown = window.history.state;
    if (entry && typeof entry === "object") {
      window.history.replaceState({ ...entry, usr: null }, "");
    }
  }, [location, headings]);

  const ancestors = ancestorTitles(page.title);
  const adminProtected = page.protection === "admin";

  return (
    <article>
      {ancestors.length > 0 ? (
        <nav
          aria-label="상위 문서"
          className="mb-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
        >
          {ancestors.map((ancestor) => (
            <span key={ancestor} className="flex items-center gap-1">
              <Link to={pageHref(ancestor)} className="hover:text-primary">
                {ancestor.split("/").at(-1)}
              </Link>
              <ChevronRight className="size-3.5" aria-hidden />
            </span>
          ))}
        </nav>
      ) : null}

      {/* 버튼은 넓은 화면에서는 제목 옆에, 폰에서는 수정 시각 아래 줄에 오른쪽으로 둔다(나무위키와
       * 같은 배치). 폰에서 제목 옆에 두면 긴 제목이 좁게 접힌다. */}
      <header className="mb-4 flex flex-col gap-2 border-b pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-3xl leading-10 font-bold break-words break-keep">
            {page.title}
            {adminProtected ? (
              <Lock
                className="size-5 shrink-0 text-muted-foreground"
                aria-label="보호된 문서"
              />
            ) : null}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {viewingOldRevision ? `r${revision.id} 저장` : "최근 수정"}{" "}
            <UpdatedAt
              value={viewingOldRevision ? revision.createdAt : page.updatedAt}
            />
          </p>
        </div>
        {/* 화면에서 가장 눈에 띄는 것은 제목이어야 한다. 버튼은 모두 차분한 외곽선으로 둔다. 별표는
         * 따로 두고, 편집·토론·기록은 한 묶음으로 붙인다. 가끔 쓰는 것(이동, 신고, 관리)은 `⋯`에
         * 넣는다. 폰에서도 한 줄에 들어간다. */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {watchAction}
          <div role="group" aria-label="문서 화면" className="flex">
            {/* 편집·기록 단추는 마우스를 올리거나 누르기 시작하면 갈 화면의 코드를 미리 받는다. 문서를
             * 읽다가 가장 많이 가는 곳이다. 편집 화면은 편집기 때문에 코드가 크다. */}
            {viewingOldRevision ? null : editable ? (
              <LinkButton
                size="sm"
                variant="outline"
                className={GROUPED}
                to={pageHref(page.title, "edit")}
                prefetch="intent"
              >
                {/* 폰에서는 아이콘을 뺀다. 글자만으로 충분하고 줄 자리가 좁다. */}
                <Pencil aria-hidden className="max-sm:hidden" />
                편집
              </LinkButton>
            ) : (
              // 고칠 수 없어도 편집기로 열어 볼 수는 있다. 표·틀을 그대로 복사해 다른 문서에 쓸 수 있다.
              // 자물쇠는 폰에서 제목 옆에 자물쇠가 없을 때(차단, 삭제)만 남긴다.
              <LinkButton
                size="sm"
                variant="outline"
                className={GROUPED}
                to={pageHref(page.title, "edit")}
                prefetch="intent"
                title={
                  adminProtected
                    ? "보호된 문서입니다. 관리자만 편집할 수 있습니다."
                    : "지금은 편집할 수 없습니다."
                }
              >
                <Lock
                  aria-hidden
                  className={adminProtected ? "max-sm:hidden" : undefined}
                />
                편집
              </LinkButton>
            )}
            <LinkButton
              size="sm"
              variant="outline"
              className={GROUPED}
              to={pageHref(page.title, "discussion")}
              aria-label={
                view.openDiscussions > 0
                  ? `토론, 열린 토론 ${view.openDiscussions}개`
                  : "토론"
              }
            >
              토론
              {view.openDiscussions > 0 ? (
                <span className="text-muted-foreground tabular-nums">
                  {view.openDiscussions}
                </span>
              ) : null}
            </LinkButton>
            <LinkButton
              size="sm"
              variant="outline"
              className={GROUPED}
              to={pageHref(page.title, "history")}
              prefetch="intent"
            >
              기록
            </LinkButton>
            {editable || menuItems.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={GROUPED}
                      aria-label="더 보기"
                    />
                  }
                >
                  <Ellipsis aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {editable ? (
                    <DropdownMenuItem
                      render={<Link to={pageHref(page.title, "move")} />}
                    >
                      이동
                    </DropdownMenuItem>
                  ) : null}
                  {menuItems.map((item) => (
                    <DropdownMenuItem
                      key={item.label}
                      variant={item.destructive ? "destructive" : "default"}
                      onClick={item.onSelect}
                    >
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </header>

      {/* 분류는 문서 맨 위에 둔다(나무위키와 같은 자리). */}
      {document.categories.length > 0 ? (
        <nav
          aria-label="분류"
          className="mb-4 flex flex-wrap items-center gap-1.5 rounded-md border px-3 py-2 text-sm"
        >
          <span className="text-muted-foreground">분류</span>
          {document.categories.map((category) => (
            <Badge
              key={category}
              variant={
                resolved.existing.has(titleKey(category))
                  ? "secondary"
                  : "outline"
              }
              render={<Link to={pageHref(category)} />}
            >
              {baseName(category)}
            </Badge>
          ))}
        </nav>
      ) : null}

      {/* 안내가 있으면 본문과 띄운다. 없으면 빈 칸이라 여백도 두지 않는다. */}
      <div className="mb-4 space-y-2 empty:mb-0">
        {view.redirectedFrom ? (
          <Notice>
            <CornerDownRight className="size-4 shrink-0" aria-hidden />
            <span>
              <Link
                to={redirectPageHref(view.redirectedFrom)}
                className="text-primary hover:underline"
              >
                {view.redirectedFrom}
              </Link>
              에서 넘어옴
            </span>
          </Notice>
        ) : null}
        {page.deletedAt ? (
          <Notice tone="warning">
            삭제된 문서입니다. 관리자에게만 보입니다.
          </Notice>
        ) : null}
        {/* 예전 판을 보는 것은 잘못이 아니다. 경고색 대신 안내로 알린다. */}
        {viewingOldRevision ? (
          <Notice>
            <span>
              이전 판(r{revision.id})을 보고 있습니다.{" "}
              <Link
                to={pageHref(page.title)}
                className="text-primary hover:underline"
              >
                최신 판 보기
              </Link>
            </span>
          </Notice>
        ) : null}
        {revision === null ? (
          <Notice tone="warning">이 판은 볼 수 없습니다.</Notice>
        ) : null}
      </div>

      {/* 넘겨주기 문서는 본문이 없다. 빈 본문·목차 대신 어디로 넘겨주는지만 보여 준다. */}
      {view.redirect ? (
        <RedirectCard
          redirect={view.redirect}
          editHref={
            editable && !viewingOldRevision
              ? pageHref(page.title, "edit")
              : null
          }
        />
      ) : (
        // 프로필이 있으면 맨 위에 두고, 프로필이 끝난 뒤에 목차와 본문이 온다.
        <WikiContent
          withToc
          document={document}
          existing={resolved.existing}
          sectionEditHref={sectionEditable ? sectionEditHref : undefined}
          renderImage={renderImage}
          beforeBody={<TableOfContents headings={document.headings} />}
        />
      )}

      {view.members.length > 0 ? (
        <TitleList
          heading={
            page.namespace === "category"
              ? `"${baseName(page.title)}" 분류에 속한 문서`
              : "이 틀을 쓰는 문서"
          }
          titles={view.members}
        />
      ) : null}

      {view.children.length > 0 ? (
        <TitleList
          heading="하위 문서"
          titles={view.children}
          // 하위 문서는 상위 이름을 떼고 보여 준다.
          label={(title) => title.slice(page.title.length + 1)}
        />
      ) : null}

      {view.aliases.length > 0 || aliasAction ? (
        <section
          aria-label="다른 이름"
          className="mt-4 flex flex-wrap items-center gap-1.5 text-sm"
        >
          <span className="text-muted-foreground">다른 이름</span>
          {view.aliases.map((alias) => (
            <Badge
              key={alias}
              variant="secondary"
              render={<Link to={redirectPageHref(alias)} />}
            >
              {alias}
            </Badge>
          ))}
          {aliasAction}
        </section>
      ) : null}

      {view.backlinks.length > 0 ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            이 문서로 연결되는 문서 {view.backlinks.length}개
          </summary>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {view.backlinks.map((link) => (
              <li key={link.title}>
                <Link
                  to={
                    link.isRedirect
                      ? redirectPageHref(link.title)
                      : pageHref(link.title)
                  }
                  className="text-primary hover:underline"
                >
                  {link.title}
                </Link>
                {link.isRedirect ? (
                  <span className="text-muted-foreground"> (넘겨주기)</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

/** 붙인 단추 묶음의 한 칸. 이웃과 테두리를 겹치고 바깥 모서리만 둥글게 한다. */
const GROUPED =
  "rounded-none not-first:-ml-px first:rounded-l-md last:rounded-r-md focus-visible:z-10";

/** 정보가 빨리 낡는 위키라, 언제 고친 글인지를 제목 바로 아래에서 보여 준다. */
function UpdatedAt({ value }: { value: string }) {
  return (
    <>
      {formatDateTime(value)} (<RelativeTime value={value} />)
    </>
  );
}

const REDIRECT_STATE_MESSAGE: Record<RedirectInfo["state"], string> = {
  ok: "이 이름으로 들어오면 위 문서로 바로 넘어갑니다.",
  missing:
    "넘겨줄 문서가 없습니다. 다른 문서로 연결하거나 해당 문서를 만들어 주세요.",
  redirect: "넘겨주기가 이어져 있습니다. 최종 문서에 바로 연결해 주세요.",
};

/** 넘겨주기 문서 자체를 볼 때(`?redirect=no`, 예전 판, 끊긴 넘겨주기). */
function RedirectCard({
  redirect,
  editHref,
}: {
  redirect: RedirectInfo;
  /** 고칠 수 없으면 `null`. */
  editHref: string | null;
}) {
  const healthy = redirect.state === "ok";
  return (
    <section
      aria-label="넘겨주기"
      className={cn(
        "rounded-lg border p-4",
        healthy ? "bg-muted/40" : "border-destructive/40 bg-destructive/5",
      )}
    >
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <CornerDownRight className="size-4 shrink-0" aria-hidden />
        넘겨주기 문서
      </p>
      <p className="mt-1.5 text-lg font-semibold break-words break-keep">
        <Link
          to={pageHref(redirect.target)}
          className={cn(
            "hover:underline",
            redirect.state === "missing" ? "text-destructive" : "text-primary",
          )}
        >
          {redirect.target}
        </Link>
        {redirect.state === "redirect" && redirect.next ? (
          <span className="font-normal text-muted-foreground">
            {" "}
            → {redirect.next}
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-sm break-keep text-muted-foreground">
        {REDIRECT_STATE_MESSAGE[redirect.state]}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {redirect.state === "missing" ? null : (
          <LinkButton size="sm" to={pageHref(redirect.target)}>
            연결된 문서 보기
          </LinkButton>
        )}
        {editHref ? (
          <LinkButton size="sm" variant="outline" to={editHref}>
            연결될 문서 변경
          </LinkButton>
        ) : null}
      </div>
    </section>
  );
}

function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning";
}) {
  return (
    <p
      className={
        tone === "warning"
          ? "flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
          : "flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
      }
    >
      {children}
    </p>
  );
}

function TitleList({
  heading,
  titles,
  label = (title) => title,
}: {
  heading: string;
  titles: readonly string[];
  label?: (title: string) => string;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 border-b pb-1.5 text-xl font-bold">{heading}</h2>
      <ul className="columns-2 gap-x-6 text-sm sm:columns-3">
        {titles.map((title) => (
          <li key={title} className="break-inside-avoid py-0.5">
            <Link to={pageHref(title)} className="text-primary hover:underline">
              {label(title)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
