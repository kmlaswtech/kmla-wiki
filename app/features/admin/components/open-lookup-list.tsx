import { Link } from "react-router";

import type { OpenLookup } from "../data/queries";
import { authorEditsHref } from "../model/author-lookup";
import { formatDateTime } from "~/shared/lib/time";

/** 내가 연, 아직 유효한 "다른 편집 보기" 허가. 화면을 나갔어도 여기서 다시 들어간다. */
export function OpenLookupList({ lookups }: { lookups: OpenLookup[] }) {
  if (lookups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        진행 중인 조회가 없습니다.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-md border text-sm">
      {lookups.map((lookup) => (
        <li
          key={lookup.id}
          className="flex flex-wrap items-center gap-2 px-3 py-2"
        >
          <Link
            to={authorEditsHref(lookup.sourceRevisionId, lookup.id)}
            className="font-medium text-primary hover:underline"
          >
            {lookup.pseudonym ?? `r${lookup.sourceRevisionId}`}
            {lookup.pageTitle ? ` (${lookup.pageTitle})` : ""}
          </Link>
          <span className="ml-auto text-muted-foreground">
            {formatDateTime(lookup.expiresAt)}까지
          </span>
        </li>
      ))}
    </ul>
  );
}
