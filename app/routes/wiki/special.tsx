import type { ReactNode } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/special";
import { withVerifiedMember } from "~/features/auth";
import { pageHref, type Namespace } from "~/features/markup";
import {
  listAllPages,
  listOrphanPages,
  listRedirectIssues,
  listWantedPages,
  SPECIAL_PAGE_SIZE,
} from "~/features/pages";
import { LinkButton } from "~/shared/components/link-button";
import { cn } from "~/shared/lib/utils";

const TABS = [
  {
    key: "wanted",
    label: "작성이 필요한 문서",
    description: "다른 문서에서 링크했지만 아직 없는 문서입니다.",
  },
  {
    key: "orphan",
    label: "고립된 문서",
    description:
      "어느 문서도 링크하지 않아 검색으로만 찾을 수 있는 문서입니다. 관련 문서에서 링크를 걸어 주세요.",
  },
  {
    key: "redirects",
    label: "잘못된 넘겨주기",
    description: "",
  },
  {
    key: "all",
    label: "모든 문서",
    description: "넘겨주기 문서는 표시되지 않습니다.",
  },
] as const;

type Tab = (typeof TABS)[number]["key"];

const NAMESPACES: { key: Namespace; label: string }[] = [
  { key: "main", label: "일반" },
  { key: "template", label: "틀" },
  { key: "category", label: "분류" },
  { key: "wiki", label: "위키" },
];

function readTab(value: string | null): Tab {
  return TABS.some((tab) => tab.key === value) ? (value as Tab) : "wanted";
}

function readNamespace(value: string | null): Namespace {
  return NAMESPACES.some((ns) => ns.key === value)
    ? (value as Namespace)
    : "main";
}

function specialHref(tab: Tab, extra: Record<string, string> = {}): string {
  return `/special?${new URLSearchParams({ tab, ...extra }).toString()}`;
}

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const params = new URL(request.url).searchParams;
  const tab = readTab(params.get("tab"));
  const namespace = readNamespace(params.get("ns"));
  const after = params.get("after") || undefined;

  return withVerifiedMember(request, async () => {
    if (tab === "wanted") {
      const wanted = await listWantedPages();
      return { tab, namespace, wanted, redirects: [], titles: [] };
    }
    if (tab === "redirects") {
      const redirects = await listRedirectIssues();
      return { tab, namespace, wanted: [], redirects, titles: [] };
    }
    const titles =
      tab === "orphan"
        ? await listOrphanPages(after)
        : await listAllPages(namespace, after);
    return { tab, namespace, wanted: [], redirects: [], titles };
  });
}

export const meta: Route.MetaFunction = () => [
  { title: "특수 기능 - 큼온 위키" },
];

export default function SpecialRoute({ loaderData }: Route.ComponentProps) {
  const { tab, namespace, wanted, redirects, titles } = loaderData;
  const current = TABS.find((item) => item.key === tab)!;
  const last = titles.at(-1);

  return (
    <div>
      <h1 className="mb-4 border-b pb-3 text-2xl font-bold">특수 기능</h1>

      <nav aria-label="특수 기능 목록" className="mb-3 flex flex-wrap gap-1">
        {TABS.map((item) => (
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

      <p className="mb-4 text-sm text-muted-foreground">
        {current.description}
      </p>

      {tab === "all" ? (
        <div className="mb-4 flex flex-wrap gap-1 text-sm">
          {NAMESPACES.map((ns) => (
            <Link
              key={ns.key}
              to={specialHref("all", { ns: ns.key })}
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

      {(tab === "orphan" || tab === "all") &&
      titles.length === SPECIAL_PAGE_SIZE &&
      last ? (
        <div className="mt-4 text-center">
          <LinkButton
            variant="outline"
            to={specialHref(tab, {
              ...(tab === "all" ? { ns: namespace } : {}),
              after: last,
            })}
          >
            더 보기
          </LinkButton>
        </div>
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
      to={`${pageHref(title)}?redirect=no`}
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
