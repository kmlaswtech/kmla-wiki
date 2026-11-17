import { data, Link } from "react-router";

import type { Route } from "./+types/diff";
import { positiveInt, titleFromParams } from "./title-param";
import { withVerifiedMember } from "~/features/auth";
import { docToText, pageHref } from "~/features/markup";
import { DiffView, getPageView, getRevisionBodies } from "~/features/pages";
import { RelativeTime } from "~/shared/components/relative-time";

export async function clientLoader({
  request,
  params,
}: Route.ClientLoaderArgs) {
  const title = titleFromParams(params);
  const url = new URL(request.url);
  const from = positiveInt(url.searchParams.get("from"));
  const to = positiveInt(url.searchParams.get("to"));
  if (!from || !to) throw data(null, { status: 404 });

  return withVerifiedMember(request, async () => {
    const view = await getPageView(title, { followRedirect: false });
    if (!view.found) throw data(null, { status: 404 });

    const revisions = await getRevisionBodies(view.page.id, [from, to]);
    return {
      title: view.page.title,
      // 숨긴 판이거나 다른 문서의 판이면 비어 있다.
      before: revisions.find((revision) => revision.id === from) ?? null,
      after: revisions.find((revision) => revision.id === to) ?? null,
    };
  });
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.title ?? ""} 판 비교 - 큼온 위키` }];
}

export default function DiffRoute({ loaderData }: Route.ComponentProps) {
  const { title, before, after } = loaderData;

  return (
    <div>
      <header className="mb-4 border-b pb-3">
        <h1 className="text-2xl font-bold">
          <Link to={pageHref(title)} className="hover:underline">
            {title}
          </Link>{" "}
          <span className="font-normal text-muted-foreground">판 비교</span>
        </h1>
        <p className="mt-1 text-sm">
          <Link
            to={pageHref(title, "history")}
            className="text-primary hover:underline"
          >
            기록으로 돌아가기
          </Link>
        </p>
      </header>

      {before && after ? (
        <>
          <dl className="mb-3 grid gap-1 text-sm sm:grid-cols-2">
            {[
              { label: "이전", sign: "−", revision: before },
              { label: "이후", sign: "+", revision: after },
            ].map(({ label, sign, revision }) => (
              <div key={revision.id} className="rounded-md border px-3 py-2">
                <dt className="font-semibold">
                  {sign} {label}{" "}
                  <Link
                    to={`${pageHref(title)}?rev=${revision.id}`}
                    className="text-primary hover:underline"
                  >
                    r{revision.id}
                  </Link>
                </dt>
                <dd className="text-muted-foreground">
                  <span className="font-mono text-xs">
                    {revision.authorPseudonym}
                  </span>{" "}
                  · <RelativeTime value={revision.createdAt} />
                  {revision.summary ? ` · ${revision.summary}` : ""}
                </dd>
              </div>
            ))}
          </dl>
          <DiffView
            before={docToText(before.body)}
            after={docToText(after.body)}
          />
        </>
      ) : (
        <p className="py-8 text-center text-muted-foreground">
          비교할 판을 볼 수 없습니다.
        </p>
      )}
    </div>
  );
}
