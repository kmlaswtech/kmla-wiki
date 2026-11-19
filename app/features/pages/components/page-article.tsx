import {
  ChevronRight,
  CornerDownRight,
  Ellipsis,
  Lock,
  Pencil,
} from "lucide-react";
import { useCallback, useMemo, type ReactNode } from "react";
import { Link } from "react-router";

import type { FoundPage, RedirectInfo } from "../model/types";
import {
  ancestorTitles,
  baseName,
  emptyDoc,
  pageHref,
  parseWiki,
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

interface PageArticleProps {
  view: FoundPage;
  /** 올린 이미지를 그리는 방법. 이미지 기능이 준다. */
  renderImage?: (imageId: string, alt: string) => ReactNode;
  /** 제목 줄 오른쪽에 덧붙일 버튼(관리 메뉴). */
  headerActions?: ReactNode;
  /** "다른 이름" 칸 끝에 둘 `이름 추가` 단추. 더할 수 없으면 비운다. */
  aliasAction?: ReactNode;
}

/**
 * 이 문서에 다른 이름(이 문서로 넘겨주는 새 문서)을 더할 수 있는가. 이 문서를 고치지 않으므로 보호
 * 여부와는 상관없다. 넘겨주기 문서에 다른 이름을 달면 이중 넘겨주기가 되므로 일반 문서의 지금 판에만.
 */
export function canAddAlias(view: FoundPage): boolean {
  return (
    (view.canEdit || view.isAdmin) &&
    view.redirect === null &&
    view.page.deletedAt === null &&
    (view.revision?.isCurrent ?? false)
  );
}

/** 이 사용자가 이 문서를 고칠 수 있는가. 화면용 판단이고 실제 판정은 서버가 한다. */
export function canEditPage(view: FoundPage): boolean {
  if (view.isAdmin) return true;
  return (
    view.canEdit &&
    view.page.protection === "open" &&
    view.page.deletedAt === null
  );
}

/** 문서 한 편: 경로, 제목, 안내, 목차, 본문, 하위 문서, 분류, 역링크. */
export function PageArticle({
  view,
  renderImage,
  headerActions,
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

  const ancestors = ancestorTitles(page.title);

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

      {/* 버튼은 제목 옆에 둔다. 폰에서도 제목 아래에 버튼 줄이 따로 생기지 않게, 좁은 화면에서는
       * `편집`과 `⋯`만 남기고 나머지를 메뉴에 넣는다. */}
      <header className="mb-4 flex items-start justify-between gap-3 border-b pb-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-3xl leading-10 font-bold break-words break-keep">
            {page.title}
            {page.protection === "admin" ? (
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
        {/* 화면에서 가장 눈에 띄는 것은 제목이어야 한다. 버튼은 모두 차분한 외곽선으로 둔다. */}
        <div className="flex shrink-0 gap-1.5">
          {viewingOldRevision ? null : editable ? (
            <LinkButton
              size="sm"
              variant="outline"
              to={pageHref(page.title, "edit")}
            >
              <Pencil aria-hidden />
              편집
            </LinkButton>
          ) : (
            // 고칠 수 없어도 편집기로 열어 볼 수는 있다. 표·틀을 그대로 복사해 다른 문서에 쓸 수 있다.
            <LinkButton
              size="sm"
              variant="outline"
              to={pageHref(page.title, "edit")}
              title={
                page.protection === "admin"
                  ? "보호된 문서라 관리자만 편집할 수 있습니다."
                  : "지금은 편집할 수 없습니다."
              }
            >
              <Lock aria-hidden />
              <span className="max-sm:sr-only">편집기로 보기</span>
            </LinkButton>
          )}
          <LinkButton
            size="sm"
            variant="outline"
            className="max-sm:hidden"
            to={pageHref(page.title, "history")}
          >
            기록
          </LinkButton>
          {editable ? (
            <LinkButton
              size="sm"
              variant="outline"
              className="max-sm:hidden"
              to={pageHref(page.title, "move")}
            >
              이동
            </LinkButton>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  // 옆의 `sm` 버튼과 높이를 맞춘다.
                  className="sm:hidden coarse:size-9"
                  aria-label="문서 메뉴"
                />
              }
            >
              <Ellipsis aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-32">
              <DropdownMenuItem
                render={<Link to={pageHref(page.title, "history")} />}
              >
                기록
              </DropdownMenuItem>
              {editable ? (
                <DropdownMenuItem
                  render={<Link to={pageHref(page.title, "move")} />}
                >
                  이동
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          {headerActions}
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

      <div className="space-y-2">
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
              예전 판(r{revision.id})을 보고 있습니다.{" "}
              <Link
                to={pageHref(page.title)}
                className="text-primary hover:underline"
              >
                현재 판 보기
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
        <>
          <TableOfContents headings={document.headings} />

          <WikiContent
            withToc
            document={document}
            existing={resolved.existing}
            sectionEditHref={sectionEditable ? sectionEditHref : undefined}
            renderImage={renderImage}
          />
        </>
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
            이 문서를 가리키는 문서 {view.backlinks.length}개
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
    "넘겨줄 문서가 없습니다. 대상을 바꾸거나 해당 문서를 먼저 만들어 주세요.",
  redirect:
    "넘겨줄 문서도 넘겨주기 문서입니다. 최종 문서로 대상을 바꿔 주세요.",
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
            대상으로 가기
          </LinkButton>
        )}
        {editHref ? (
          <LinkButton size="sm" variant="outline" to={editHref}>
            대상 바꾸기
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
