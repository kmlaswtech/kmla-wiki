import { Link, redirect } from "react-router";

import type { Route } from "./+types/search";
import { withVerifiedMember } from "~/features/auth";
import { pageHref, parseTitle } from "~/features/markup";
import { findExactTitle, searchPages } from "~/features/pages";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();

  // 검색을 먼저 보낸다. 아래에서 정확한 제목을 찾는 동안 기다리지 않게 한다.
  const search = withVerifiedMember(request, () => searchPages(query));
  // 검색 실패는 결과 목록을 보여 줄 때만 알린다. 정확한 제목으로 가는 길을 막지 않는다.
  search.catch(() => undefined);

  // 머리띠 검색창에서 Enter를 친 경우(`go=1`). 제목이 정확히 맞는 문서가 있으면 바로 연다. 검색
  // 결과는 버린다.
  if (params.get("go") === "1" && query !== "") {
    const exact = await withVerifiedMember(request, () =>
      findExactTitle(query),
    );
    if (exact) throw redirect(pageHref(exact));
  }

  return { query, hits: await search };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.query ?? ""} 검색 - 큼온 위키` }];
}

export default function SearchRoute({ loaderData }: Route.ComponentProps) {
  const { query, hits } = loaderData;
  const asTitle = parseTitle(query);
  const exact = hits.some(
    (hit) => hit.title.toLowerCase() === asTitle?.toLowerCase(),
  );

  return (
    <div>
      <h1 className="mb-4 border-b pb-3 text-2xl font-bold">
        {query ? `"${query}" 검색` : "검색"}
      </h1>

      {query === "" ? (
        <p className="text-muted-foreground">
          위의 검색창에 찾을 말을 넣어 주세요.
        </p>
      ) : (
        <>
          {/* 찾는 문서가 없으면 바로 만들 수 있게 한다. */}
          {asTitle && !exact ? (
            <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm">
              <Link
                to={pageHref(asTitle)}
                className="font-medium text-destructive hover:underline"
              >
                {asTitle}
              </Link>{" "}
              문서는 아직 없습니다. 눌러서 만들 수 있습니다.
            </p>
          ) : null}

          {hits.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              찾은 문서가 없습니다.
            </p>
          ) : (
            <ul className="divide-y">
              {hits.map((hit) => (
                <li key={hit.title} className="py-3">
                  <Link
                    to={pageHref(hit.title)}
                    className="text-lg font-medium text-primary hover:underline"
                  >
                    {hit.title}
                  </Link>
                  {hit.matchedRedirect ? (
                    <span className="ml-2 text-sm text-muted-foreground">
                      ({hit.matchedRedirect}에서 넘겨줌)
                    </span>
                  ) : null}
                  {hit.snippet ? (
                    <p className="mt-0.5 text-sm break-words text-muted-foreground">
                      {hit.snippet}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
