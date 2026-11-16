import type { Root as HastRoot } from "hast";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import {
  collectFootnotes,
  collectHeadings,
  rehypeSafeUrls,
  rehypeSections,
  type FootnoteMap,
  remarkHeadings,
  remarkHtmlAsText,
  remarkUnderline,
  remarkWikiDirectives,
  type HeadingInfo,
} from "./plugins";
import { preprocess, type PreprocessOptions } from "./preprocess";

export interface ParsedDocument {
  /** 화면에 그릴 트리. 원시 HTML은 들어 있지 않다. */
  tree: HastRoot;
  headings: HeadingInfo[];
  /** 각주 id별 내용. 본문의 각주 번호에 미리보기로 띄운다. */
  footnotes: FootnoteMap;
  categories: string[];
  /** 넘겨주기 문서면 대상 제목. */
  redirect: string | null;
}

/**
 * 파서 구성. KMLA Online과 같은 계열(unified + remark)이고 한국어 강조 규칙도 같다.
 *
 * 순서에 뜻이 있다.
 *  - 지시문 정리는 밑줄·HTML 처리보다 먼저: 되돌린 글자가 다른 규칙에 다시 걸리지 않는다.
 *  - 제목 id는 마크다운 트리에서: 목차와 문단 편집이 같은 번호를 쓴다.
 *  - 주소 거르기는 마지막: 앞 단계가 만든 링크까지 모두 본다.
 */
function createProcessor() {
  return (
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      // 조사가 붙은 한국어에서 `**끝.**다음` 같은 강조가 풀리지 않게 한다.
      .use(remarkCjkFriendly)
      .use(remarkCjkFriendlyGfmStrikethrough)
      .use(remarkDirective)
      .use(remarkWikiDirectives)
      .use(remarkUnderline)
      .use(remarkHtmlAsText)
      .use(remarkHeadings)
      .use(remarkRehype, {
        footnoteLabel: "각주",
        footnoteBackLabel: "본문으로 돌아가기",
      })
      .use(rehypeSafeUrls)
      .use(rehypeSections)
  );
}

let processor: ReturnType<typeof createProcessor> | undefined;

/** 위키 본문을 화면용 트리로 바꾼다. 순수 함수다(같은 입력에 같은 출력, I/O 없음). */
export function parseWiki(
  body: string,
  options: PreprocessOptions = {},
): ParsedDocument {
  processor ??= createProcessor();

  const { markdown, categories, redirect } = preprocess(body, options);
  const mdast = processor.parse(markdown);
  // 플러그인이 `mdast`를 그 자리에서 고치므로, 실행 뒤에 같은 트리에서 제목을 읽을 수 있다.
  const tree = processor.runSync(mdast, markdown);

  return {
    tree,
    headings: collectHeadings(mdast),
    footnotes: collectFootnotes(tree),
    categories,
    redirect,
  };
}
