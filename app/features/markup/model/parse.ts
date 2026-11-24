import {
  asWikiDoc,
  NODE,
  nodeText,
  numberAttr,
  stringAttr,
  stringListAttr,
  type WikiDoc,
  type WikiNode,
} from "./doc";
import { createHeadingIdAllocator } from "./heading-id";
import { profileOf } from "./profile";
import { normalizeCategories, redirectTargetOf, templateTitle } from "./refs";
import { headingDepth } from "./sections";
import { titleKey } from "./title";

/** 틀 안의 틀은 3단계까지 끼워 넣는다. DB의 `resolve_body`가 같은 깊이까지 본문을 내려 준다. */
const MAX_TEMPLATE_DEPTH = 3;

export interface HeadingInfo {
  /** 2~4. */
  depth: number;
  text: string;
  id: string;
  /** 목차 순서(0부터). */
  index: number;
  /**
   * 이 문서 자신의 몇 번째 제목인지(문단 편집 번호). 틀이 끼워 넣은 제목은 `null`이다. 그 제목은
   * 이 문서를 고쳐서는 바꿀 수 없다.
   */
  sectionIndex: number | null;
}

export interface Footnote {
  /** 본문에 붙는 번호(1부터). */
  number: number;
  /** 각주 내용(인라인 노드). 틀 값 자리는 이미 채웠다. */
  content: WikiNode[];
}

/** 화면에 그릴 문단 하나. 맨 바깥 블록마다 하나다. */
export interface RenderBlock {
  node: WikiNode;
  /** 제목 블록이면 목차 정보. */
  heading?: HeadingInfo;
}

export interface ParsedDocument {
  /** 틀을 끼워 넣고 각주에 번호를 붙인 맨 바깥 블록들. */
  blocks: RenderBlock[];
  headings: HeadingInfo[];
  footnotes: Footnote[];
  categories: string[];
  /** 넘겨주기 문서면 대상 제목. */
  redirect: string | null;
  /**
   * 프로필 블록(틀을 펼치고 각주 번호를 붙인 것). 본문보다 먼저 보이므로 각주 번호도 먼저 받는다.
   * 프로필 안의 제목은 목차·문단에 들지 않는다. 틀 본문의 프로필은 끼워 넣지 않는다.
   */
  profile: WikiNode[] | null;
}

export interface ParseOptions {
  /** 끼워 넣을 틀의 본문. 키는 `titleKey(틀 제목)`. */
  templates?: ReadonlyMap<string, WikiDoc>;
}

/** 그릴 때만 쓰는 노드. 틀 자리에 남기는 "없는 틀" 표시다. */
export const MISSING_TEMPLATE = "wiki:missingTemplate";

interface Context {
  templates: ReadonlyMap<string, WikiDoc>;
  footnotes: Footnote[];
}

/**
 * 저장된 문서를 화면에 그릴 모양으로 준비한다. 순수 함수다(같은 입력에 같은 출력, I/O 없음).
 *
 *  - 틀 자리에 틀 본문을 끼워 넣고 값 자리(`{{{1}}}`)를 채운다.
 *  - 맨 바깥 제목에 id와 목차 번호를 매긴다.
 *  - 각주에 차례대로 번호를 붙인다.
 */
export function parseWiki(
  value: unknown,
  { templates = new Map() }: ParseOptions = {},
): ParsedDocument {
  const doc = asWikiDoc(value);
  const context: Context = { templates, footnotes: [] };

  const blocks: RenderBlock[] = [];
  const headings: HeadingInfo[] = [];
  const allocate = createHeadingIdAllocator();
  let ownHeadings = 0;

  const rawProfile = profileOf(doc);
  const profile = rawProfile
    ? rawProfile.flatMap((block) =>
        block.type === NODE.template
          ? expandTemplate(block, context, [])
          : [prepare(block, context, [])],
      )
    : null;

  const pushTopLevel = (node: WikiNode, own: boolean) => {
    if (node.type !== NODE.heading) {
      blocks.push({ node });
      return;
    }
    const text = nodeText(node).trim();
    const heading: HeadingInfo = {
      depth: headingDepth(node),
      text,
      id: allocate(text),
      index: headings.length,
      sectionIndex: own ? ownHeadings : null,
    };
    if (own) ownHeadings++;
    headings.push(heading);
    blocks.push({ node, heading });
  };

  for (const block of doc.content) {
    if (block.type === NODE.template) {
      // 틀이 넣은 맨 바깥 블록도 문서 흐름의 일부다(틀이 제목을 넣으면 목차에 나온다).
      for (const node of expandTemplate(block, context, [])) {
        pushTopLevel(node, false);
      }
      continue;
    }
    // 틀이 아닌 자리의 제목은 이 문서의 것이다. 제목 안에는 틀이 들어갈 수 없다.
    pushTopLevel(prepare(block, context, []), true);
  }

  return {
    blocks,
    headings,
    footnotes: context.footnotes,
    categories: normalizeCategories(doc.attrs?.categories ?? []),
    redirect: redirectTargetOf(doc),
    profile,
  };
}

/** 노드를 복사하면서 안쪽의 틀을 펼치고 각주에 번호를 붙인다. */
function prepare(
  node: WikiNode,
  context: Context,
  stack: readonly string[],
  values?: readonly string[],
): WikiNode {
  if (node.type === NODE.footnote) {
    // 번호는 바깥 순서대로 먼저 받는다. 각주 안에는 각주가 없으므로 안을 채워도 번호가 밀리지 않는다.
    const number = context.footnotes.length + 1;
    const footnote: Footnote = { number, content: [] };
    context.footnotes.push(footnote);
    footnote.content = prepareContent(
      node.content ?? [],
      context,
      stack,
      values,
    );
    return {
      ...node,
      attrs: { ...node.attrs, number },
      content: footnote.content,
    };
  }
  if (node.type === NODE.templateParam && values) {
    const index = numberAttr(node, "index") ?? 1;
    // 틀 작성자가 그 자리에 건 꾸밈(굵게, 링크 등)은 값에도 그대로 건다.
    return {
      type: NODE.text,
      text: values[index - 1]?.trim() ?? "",
      ...(node.marks ? { marks: node.marks } : {}),
    };
  }
  if (!node.content) return node;
  return {
    ...node,
    content: prepareContent(node.content, context, stack, values),
  };
}

function prepareContent(
  nodes: readonly WikiNode[],
  context: Context,
  stack: readonly string[],
  values?: readonly string[],
): WikiNode[] {
  const content: WikiNode[] = [];
  for (const child of nodes) {
    if (child.type === NODE.template) {
      content.push(...expandTemplate(child, context, stack, values));
    } else {
      const prepared = prepare(child, context, stack, values);
      // 빈 값으로 채운 자리는 빈 글자 노드가 된다. 그리지 않는다.
      if (prepared.type === NODE.text && !prepared.text) continue;
      content.push(prepared);
    }
  }
  return content;
}

/**
 * 틀 자리에 틀 본문을 끼워 넣는다.
 *
 * 틀이 없거나, 자기 자신을 다시 부르거나, 너무 깊으면 그 자리에 틀 문서 링크를 남긴다. 없는 틀은
 * 빨간 링크가 되어 "여기 틀이 있어야 한다"는 것이 보인다.
 */
function expandTemplate(
  node: WikiNode,
  context: Context,
  stack: readonly string[],
  outer?: readonly string[],
): WikiNode[] {
  const title = templateTitle(stringAttr(node, "name"));
  if (!title) return [];

  const key = titleKey(title);
  const body = context.templates.get(key);
  if (
    body === undefined ||
    stack.includes(key) ||
    stack.length >= MAX_TEMPLATE_DEPTH
  ) {
    return [{ type: MISSING_TEMPLATE, attrs: { title } }];
  }

  // 틀 안에서 다른 틀을 부를 때 값에 `{{{1}}}`을 적으면 바깥 틀이 받은 값을 넘긴다.
  const values = stringListAttr(node, "args").map((arg) =>
    outer ? fillValues(arg, outer) : arg,
  );
  const nextStack = [...stack, key];
  const nodes: WikiNode[] = [];
  for (const block of asWikiDoc(body).content) {
    if (block.type === NODE.template) {
      nodes.push(...expandTemplate(block, context, nextStack, values));
    } else {
      nodes.push(prepare(block, context, nextStack, values));
    }
  }
  return nodes;
}

/** 값 글자 안의 `{{{번호}}}`를 바깥 틀이 받은 값으로 바꾼다. 없는 번호는 빈 글자. */
function fillValues(arg: string, outer: readonly string[]): string {
  return arg.replace(
    /\{\{\{(\d+)\}\}\}/g,
    (_, index: string) => outer[Number(index) - 1]?.trim() ?? "",
  );
}
