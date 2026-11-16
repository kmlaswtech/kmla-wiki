import { MIN_TOC_HEADINGS, numberHeadings } from "../model/heading-number";
import type { HeadingInfo } from "../model/plugins";

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
      className="my-4 inline-block max-w-full scroll-mt-16 rounded-lg border bg-muted/40 px-4 py-3 text-sm"
    >
      <p className="mb-1 font-semibold">목차</p>
      <ol className="space-y-0.5">
        {numberHeadings(headings).map((heading) => (
          <li
            key={heading.id}
            style={{ paddingLeft: `${(heading.level - 1) * 1}rem` }}
          >
            <a
              href={`#${encodeURI(heading.id)}`}
              className="text-primary hover:underline"
            >
              <span className="mr-1.5 tabular-nums">{heading.number}.</span>
              {heading.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
