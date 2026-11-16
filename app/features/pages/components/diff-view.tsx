import { useMemo } from "react";

import { diffRevisions, type DiffSegment } from "../model/diff";
import { cn } from "~/shared/lib/utils";

/** 두 본문의 차이를 원문 그대로 보여 준다. 판 비교와 편집 충돌 화면이 쓴다. */
export function DiffView({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => diffRevisions(before, after), [before, after]);

  if (rows.every((row) => row.type === "same" || row.type === "gap")) {
    return (
      <p className="py-8 text-center text-muted-foreground">
        두 판의 내용이 같습니다.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border font-mono text-sm leading-6">
      {rows.map((row, index) => {
        if (row.type === "gap") {
          return (
            <div
              key={index}
              className="bg-muted px-3 py-0.5 text-center font-sans text-xs text-muted-foreground"
            >
              바뀌지 않은 {row.count}줄
            </div>
          );
        }
        if (row.type === "same") {
          return (
            <Line key={index} marker=" ">
              {row.text}
            </Line>
          );
        }
        const added = row.type === "added";
        return (
          <Line
            key={index}
            marker={added ? "+" : "-"}
            className={added ? "bg-emerald-500/10" : "bg-destructive/10"}
          >
            {row.segments.map((segment, segmentIndex) => (
              <Segment key={segmentIndex} segment={segment} added={added} />
            ))}
          </Line>
        );
      })}
    </div>
  );
}

function Line({
  marker,
  className,
  children,
}: {
  marker: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex", className)}>
      <span
        aria-hidden
        className="w-6 shrink-0 text-center text-muted-foreground select-none"
      >
        {marker}
      </span>
      <span className="min-w-0 flex-1 pr-3 break-all whitespace-pre-wrap">
        {children}
        {/* 빈 줄도 한 줄 높이를 차지하게 한다. */}
        {"​"}
      </span>
    </div>
  );
}

function Segment({ segment, added }: { segment: DiffSegment; added: boolean }) {
  if (!segment.changed) return <>{segment.text}</>;
  return added ? (
    <ins className="rounded-sm bg-emerald-500/30 no-underline">
      {segment.text}
    </ins>
  ) : (
    <del className="rounded-sm bg-destructive/30 no-underline">
      {segment.text}
    </del>
  );
}
