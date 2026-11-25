import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import {
  sortDiscussions,
  topicHref,
  type DiscussionSort,
} from "../model/rules";
import type { DiscussionSummary } from "../model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";
import { Checkbox } from "~/shared/ui/checkbox";
import { Label } from "~/shared/ui/label";
import { NativeSelect } from "~/shared/ui/native-select";

/** 문서의 토론 목록과 정렬·"열린 것만" 거르개. */
export function DiscussionList({
  discussions,
  revisionHref,
}: {
  discussions: readonly DiscussionSummary[];
  /** 붙인 판을 여는 주소. */
  revisionHref: (revisionId: number) => string;
}) {
  const [sort, setSort] = useState<DiscussionSort>("recent");
  const [openOnly, setOpenOnly] = useState(false);

  const rows = sortDiscussions(
    openOnly ? discussions.filter((row) => row.isOpen) : discussions,
    sort,
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <NativeSelect
          size="sm"
          aria-label="정렬"
          value={sort}
          onChange={(event) => setSort(event.target.value as DiscussionSort)}
        >
          <option value="recent">최근 활동순</option>
          <option value="open-first">열린 것 먼저</option>
        </NativeSelect>
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={openOnly} onCheckedChange={setOpenOnly} />
          열린 것만
        </Label>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          {discussions.length === 0
            ? "토론이 없습니다."
            : "열린 토론이 없습니다."}
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((row) => (
            <li
              key={row.id}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5",
                row.deleted && "opacity-60",
              )}
            >
              <Badge variant={row.isOpen ? "default" : "outline"}>
                {row.isOpen ? "열림" : "닫힘"}
              </Badge>
              <Link
                to={topicHref(row.id)}
                className="min-w-0 flex-1 basis-48 font-medium break-words text-primary hover:underline"
              >
                {row.title}
              </Link>
              {row.deleted ? <Badge variant="outline">지움</Badge> : null}
              <span className="flex shrink-0 flex-wrap items-center gap-x-3 text-muted-foreground">
                {row.revisionId !== null ? (
                  <Link
                    to={revisionHref(row.revisionId)}
                    className="tabular-nums hover:underline"
                  >
                    r{row.revisionId}
                  </Link>
                ) : null}
                <span className="font-mono text-xs">{row.openerName}</span>
                <span className="flex items-center gap-1 tabular-nums">
                  <MessageSquare className="size-3.5" aria-label="글 수" />
                  {row.postCount}
                </span>
                <RelativeTime value={row.lastPostAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
