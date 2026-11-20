import { Link } from "react-router";

import type { MissingPage } from "../model/types";
import { pageHref } from "~/features/markup";
import { LinkButton } from "~/shared/components/link-button";

/** 없는 문서. 빨간 링크를 눌러 들어오는 곳이라, 바로 만들 수 있게 한다. */
export function MissingArticle({ view }: { view: MissingPage }) {
  return (
    <article>
      <h1 className="mb-4 border-b pb-3 text-3xl leading-10 font-bold">
        {view.title}
      </h1>
      <p className="text-muted-foreground">이 문서는 아직 없습니다.</p>
      {view.title && view.validTitle && view.canEdit ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <LinkButton to={pageHref(view.title, "edit")}>
            이 문서 만들기
          </LinkButton>
          {/* 줄임말·옛 이름처럼 이미 있는 문서의 다른 이름이라면 넘겨주기로 만든다. */}
          <LinkButton
            variant="outline"
            to={`${pageHref(view.title, "edit")}?as=redirect`}
          >
            다른 문서로 넘겨주기
          </LinkButton>
        </div>
      ) : null}
      {view.backlinks.length > 0 ? (
        <section className="mt-8 text-sm">
          <h2 className="mb-2 font-semibold">이 문서를 가리키는 문서</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {view.backlinks.map((link) => (
              <li key={link.title}>
                <Link
                  to={pageHref(link.title)}
                  className="text-primary hover:underline"
                >
                  {link.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
