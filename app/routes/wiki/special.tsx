import type { ReactNode } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/special";
import { nonNegativeInt } from "./title-param";
import { withVerifiedMember } from "~/features/auth";
import { pageHref, redirectPageHref } from "~/features/markup";
import {
  listAllPages,
  listOrphanPages,
  listPagesBySize,
  listRedirectIssues,
  listWantedPages,
  SPECIAL_NAMESPACE_TABS,
  SPECIAL_NAMESPACES,
  readSpecialNamespace,
  readSpecialTab,
  sizeListOffset,
  SPECIAL_PAGE_SIZE,
  specialHref,
  SPECIAL_TABS,
} from "~/features/pages";
import { LinkButton } from "~/shared/components/link-button";
import { PageNav } from "~/shared/components/page-nav";
import { cn } from "~/shared/lib/utils";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const params = new URL(request.url).searchParams;
  const tab = readSpecialTab(params.get("tab"));
  const namespace = readSpecialNamespace(params.get("ns"));
  const after = params.get("after") || undefined;

  const offset = sizeListOffset(nonNegativeInt(params.get("offset")));
  const empty = {
    wanted: [],
    redirects: [],
    titles: [],
    sized: [],
    offset,
    paged: after !== undefined,
    more: false,
  };

  return withVerifiedMember(request, async () => {
    if (tab === "wanted") {
      const wanted = await listWantedPages();
      return { ...empty, tab, namespace, wanted };
    }
    if (tab === "redirects") {
      const redirects = await listRedirectIssues();
      return { ...empty, tab, namespace, redirects };
    }
    if (tab === "short" || tab === "long") {
      const sized = await listPagesBySize(namespace, tab === "long", offset);
      return { ...empty, tab, namespace, sized: sized.rows, more: sized.more };
    }
    const titles =
      tab === "orphan"
        ? await listOrphanPages(after)
        : await listAllPages(namespace, after);
    return {
      ...empty,
      tab,
      namespace,
      titles: titles.rows,
      more: titles.more,
    };
  });
}

export const meta: Route.MetaFunction = () => [
  { title: "특수 기능 - 큼온 위키" },
];

export default function SpecialRoute({ loaderData }: Route.ComponentProps) {
  const {
    tab,
    namespace,
    wanted,
    redirects,
    titles,
    sized,
    offset,
    paged,
    more,
  } = loaderData;
  const current = SPECIAL_TABS.find((item) => item.key === tab)!;
  const last = titles.at(-1);
  const sizedTab = tab === "short" || tab === "long";
  const titleTab = tab === "orphan" || tab === "all";
  const nsParam: Record<string, string> =
    tab === "orphan" ? {} : { ns: namespace };
  // 쪽 넘기기. 크기 순 목록은 건너뛸 개수로 앞뒤로 간다. 제목 순 목록은 마지막 제목 다음부터만
  // 이어 읽으므로(`after`) 앞 쪽으로 가는 단추가 없다.
  const firstHref =
    (sizedTab && offset > 0) || (titleTab && paged)
      ? specialHref(tab, nsParam)
      : null;
  const prevHref =
    sizedTab && offset > 0
      ? specialHref(
          tab,
          offset > SPECIAL_PAGE_SIZE
            ? { ...nsParam, offset: String(offset - SPECIAL_PAGE_SIZE) }
            : nsParam,
        )
      : null;
  const nextHref =
    sizedTab && more
      ? specialHref(tab, {
          ...nsParam,
          offset: String(offset + SPECIAL_PAGE_SIZE),
        })
      : titleTab && more && last
        ? specialHref(tab, { ...nsParam, after: last })
        : null;

  return (
    <div>
      <h1 className="mb-4 border-b pb-3 text-2xl font-bold">특수 기능</h1>

      <nav aria-label="특수 기능 목록" className="mb-3 flex flex-wrap gap-1">
        {SPECIAL_TABS.map((item) => (
          <LinkButton
            key={item.key}
            to={specialHref(item.key)}
            size="sm"
            variant={item.key === tab ? "secondary" : "ghost"}
            aria-current={item.key === tab ? "page" : undefined}
          >
            {item.label}
          </LinkButton>
        ))}
      </nav>

      {current.description ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {current.description}
        </p>
      ) : null}

      {SPECIAL_NAMESPACE_TABS.includes(tab) ? (
        <div className="mb-4 flex flex-wrap gap-1 text-sm">
          {SPECIAL_NAMESPACES.map((ns) => (
            <Link
              key={ns.key}
              to={specialHref(tab, { ns: ns.key })}
              aria-current={ns.key === namespace ? "page" : undefined}
              className={cn(
                "rounded px-2 py-0.5 hover:bg-muted",
                ns.key === namespace
                  ? "bg-muted font-medium"
                  : "text-muted-foreground",
              )}
            >
              {ns.label}
            </Link>
          ))}
        </div>
      ) : null}

      {tab === "redirects" ? (
        <RedirectIssues rows={redirects} />
      ) : sizedTab ? (
        sized.length === 0 ? (
          <Empty />
        ) : (
          <ol className="divide-y text-sm">
            {sized.map((row, index) => (
              <li key={row.title} className="flex items-baseline gap-3 py-2">
                <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">
                  {offset + index + 1}
                </span>
                <span className="min-w-0">
                  <Link
                    to={pageHref(row.title)}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.title}
                  </Link>{" "}
                  <span className="text-muted-foreground tabular-nums">
                    ({row.textSize.toLocaleString("ko")}자)
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )
      ) : tab === "wanted" ? (
        wanted.length === 0 ? (
          <Empty />
        ) : (
          <ul className="divide-y text-sm">
            {wanted.map((row) => (
              <li key={row.title} className="flex items-center gap-3 py-2">
                <Link
                  to={pageHref(row.title)}
                  className="font-medium text-destructive hover:underline"
                >
                  {row.title}
                </Link>
                <span className="text-muted-foreground tabular-nums">
                  링크 {row.refCount}개
                </span>
              </li>
            ))}
          </ul>
        )
      ) : titles.length === 0 ? (
        <Empty />
      ) : (
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {titles.map((title) => (
            <li key={title}>
              <Link
                to={pageHref(title)}
                className="text-primary hover:underline"
              >
                {title}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {sizedTab || titleTab ? (
        <PageNav first={firstHref} prev={prevHref} next={nextHref} />
      ) : null}
    </div>
  );
}

/** 끊긴 넘겨주기와 이중 넘겨주기. 넘겨주기 문서 자체를 열어 고치게 한다. */
function RedirectIssues({
  rows,
}: {
  rows: { title: string; target: string; next: string | null }[];
}) {
  const broken: ReactNode[] = [];
  const double: ReactNode[] = [];
  for (const { title, target, next } of rows) {
    if (next === null) {
      broken.push(
        <IssueRow key={title} title={title}>
          <Link
            to={pageHref(target)}
            className="text-destructive hover:underline"
          >
            {target}
          </Link>
        </IssueRow>,
      );
    } else {
      double.push(
        <IssueRow key={title} title={title}>
          <RedirectLink title={target} />
          <span aria-hidden>→</span>
          <Link to={pageHref(next)} className="text-primary hover:underline">
            {next}
          </Link>
        </IssueRow>,
      );
    }
  }
  return (
    <div className="space-y-6 text-sm">
      <IssueList heading="끊긴 넘겨주기" items={broken} />
      <IssueList heading="이중 넘겨주기" items={double} />
    </div>
  );
}

function IssueList({
  heading,
  items,
}: {
  heading: string;
  items: ReactNode[];
}) {
  return (
    <section>
      <h2 className="mb-2 font-semibold">
        {heading} {items.length}개
      </h2>
      {items.length === 0 ? <Empty /> : <ul className="divide-y">{items}</ul>}
    </section>
  );
}

/** 넘겨주기 문서 → 그 뒤로 이어지는 곳. */
function IssueRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap gap-x-2 py-2">
      <RedirectLink title={title} />
      <span aria-hidden>→</span>
      {children}
    </li>
  );
}

/** 넘겨주기 문서 자체를 여는 링크(따라가지 않는다). */
function RedirectLink({ title }: { title: string }) {
  return (
    <Link
      to={redirectPageHref(title)}
      className="font-medium text-primary hover:underline"
    >
      {title}
    </Link>
  );
}

function Empty() {
  return (
    <p className="py-8 text-center text-muted-foreground">
      해당하는 문서가 없습니다.
    </p>
  );
}
