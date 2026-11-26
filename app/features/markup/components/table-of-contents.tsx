import { MIN_TOC_HEADINGS, numberHeadings } from "../model/heading-number";
import type { HeadingInfo } from "../model/parse";

/** 목차의 id. 본문 제목 번호를 누르면 여기로 돌아온다. */
export const TOC_ID = "toc";

export function TableOfContents({
  headings,
}: {
  headings: readonly HeadingInfo[];
}) {
  if (headings.length < MIN_TOC_HEADINGS) return null;

  return (
    <nav
      id={TOC_ID}
      aria-label="목차"
      className="my-4 w-fit max-w-full rounded-lg border bg-muted/40 px-4 py-3 text-sm"
    >
      <p className="mb-1 font-semibold">목차</p>
      <ol className="space-y-0.5">
        {numberHeadings(headings).map((heading) => (
          <li
            key={heading.id}
            style={{ paddingLeft: `${(heading.level - 1) * 1}rem` }}
          >
            {/* 번호만 링크 색으로 두어 목차 상자가 온통 파랗게 보이지 않게 한다. */}
            <a
              href={`#${encodeURI(heading.id)}`}
              className="hover:text-primary hover:underline focus-visible:text-primary coarse:inline-block coarse:py-0.5"
            >
              <span className="mr-1.5 text-primary tabular-nums">
                {heading.number}.
              </span>
              {heading.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
