import { transformOutsideCode } from "./code-regions";
import { headingId } from "./heading-id";
import {
  FOLD_OPEN,
  REDIRECT,
  TEMPLATE_CALL,
  TEMPLATE_PARAMETER,
  WIKI_LINK,
  WIKI_SCHEME,
} from "./syntax";
import { namespaceOf, parseTitle, titleKey } from "./title";

/**
 * 위키 문법을 표준 마크다운으로 바꾸는 단계.
 *
 * 마크다운 파서에 확장을 끼우는 대신 파싱 전에 글자를 바꾼다. 이유:
 *  - `[[문서|표시]]`를 `[표시](wiki:문서)`로 바꾸면 표 안에서도 `|`가 칸을 가르지 않는다.
 *    사용자가 `\|`를 알 필요가 없다.
 *  - 틀은 본문을 그대로 끼워 넣는 것이라, 파싱 전에 끼워야 틀 안의 문법도 같이 해석된다.
 *  - `:::접기`는 마크다운 지시문이 한글 이름을 받지 않아서 내부 이름으로 바꾼다.
 *
 * 저장되는 원문은 바뀌지 않는다. 여기서 바꾼 글자는 화면을 그리는 데만 쓴다.
 */

/** 틀 안의 틀은 3단계까지 끼워 넣는다. DB의 `resolve_body`가 같은 깊이까지 본문을 내려 준다. */
const MAX_TEMPLATE_DEPTH = 3;

export interface PreprocessOptions {
  /** 끼워 넣을 틀의 본문. 키는 `titleKey(틀 제목)`. */
  templates?: ReadonlyMap<string, string>;
}

export interface Preprocessed {
  /** 표준 마크다운(+ 지시문)으로 바뀐 본문. */
  markdown: string;
  /** 이 문서가 속한 분류. 끼워 넣은 틀의 분류는 세지 않는다. */
  categories: string[];
  /** 넘겨주기 문서면 대상 제목. */
  redirect: string | null;
}

export function preprocess(
  body: string,
  { templates = new Map() }: PreprocessOptions = {},
): Preprocessed {
  const categories: string[] = [];

  const expanded = expandTemplates(body, templates, []);
  const markdown = transformOutsideCode(expanded, (text) =>
    convertFolds(convertLinks(text, categories)),
  );

  const redirect = REDIRECT.exec(body);

  return {
    markdown,
    categories: [...new Set(categories)],
    redirect: redirect ? parseTitle(redirect[1]!) : null,
  };
}

/**
 * `{{틀:이름|값}}` 자리에 틀 본문을 끼워 넣는다.
 *
 * 틀이 없거나, 자기 자신을 다시 부르거나, 너무 깊으면 그 자리를 틀 문서 링크로 남긴다. 없는 틀은
 * 빨간 링크가 되어 "여기 틀이 있어야 한다"는 것이 보인다.
 */
function expandTemplates(
  source: string,
  templates: ReadonlyMap<string, string>,
  stack: readonly string[],
): string {
  return transformOutsideCode(source, (text) =>
    text.replace(TEMPLATE_CALL, (call, rawName: string, rawValues: string) => {
      const title = parseTitle(rawName);
      if (!title) return call;

      const key = titleKey(title);
      const body = templates.get(key);
      if (
        body === undefined ||
        stack.includes(key) ||
        stack.length >= MAX_TEMPLATE_DEPTH
      ) {
        return `[[${title}]]`;
      }

      const values = rawValues === "" ? [] : rawValues.slice(1).split("|");
      const filled = stripForInclusion(body).replace(
        TEMPLATE_PARAMETER,
        (_, position: string) => values[Number(position) - 1]?.trim() ?? "",
      );
      return expandTemplates(filled, templates, [...stack, key]);
    }),
  );
}

/** 틀 문서 자신의 분류는 틀을 쓰는 문서로 번지지 않는다. */
function stripForInclusion(templateBody: string): string {
  return transformOutsideCode(templateBody.trim(), (text) =>
    text.replace(WIKI_LINK, (link, rawTarget: string) => {
      const title = parseTitle(rawTarget);
      return title && namespaceOf(title) === "category" ? "" : link;
    }),
  );
}

function convertLinks(text: string, categories: string[]): string {
  return text.replace(
    WIKI_LINK,
    (
      link,
      rawTarget: string,
      section: string | undefined,
      label: string | undefined,
    ) => {
      const shown = label?.trim();

      // `[[#문단]]`: 같은 문서 안의 이동.
      if (rawTarget.trim() === "") {
        if (section === undefined || section.trim() === "") return link;
        return markdownLink(shown || section.trim(), `#${headingId(section)}`);
      }

      const forcedLink = /^\s*:/.test(rawTarget);
      const title = parseTitle(
        forcedLink ? rawTarget.replace(/^\s*:/, "") : rawTarget,
      );
      if (!title) return link;

      if (!forcedLink && namespaceOf(title) === "category") {
        categories.push(title);
        return "";
      }

      const anchor = section?.trim() ? `#${headingId(section)}` : "";
      const fallback = section?.trim() ? `${title}#${section.trim()}` : title;
      return markdownLink(
        shown || fallback,
        `${WIKI_SCHEME}${encodeURIComponent(title)}${encodeURI(anchor)}`,
      );
    },
  );
}

function markdownLink(label: string, href: string): string {
  // 표시 이름 안의 마크다운 문법은 그대로 살린다(굵게 등). 링크를 깨는 글자만 막는다.
  const safeLabel = label.replace(/[\\[\]]/g, "\\$&");
  return `[${safeLabel}](${href})`;
}

/** `:::접기 제목` → `:::fold[제목]`. 닫는 `:::`은 그대로 쓴다. */
function convertFolds(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const open = FOLD_OPEN.exec(line);
      if (!open) return line;
      const title = (open[2] ?? "").trim() || "펼치기";
      return `${open[1]}:::fold[${title.replace(/[\\[\]]/g, "\\$&")}]`;
    })
    .join("\n");
}
