import {
  asWikiDoc,
  MARK,
  NODE,
  nodeText,
  stringAttr,
  walk,
  type WikiDoc,
  type WikiMark,
  type WikiNode,
} from "./doc";
import { createHeadingIdAllocator } from "./heading-id";
import { profileOf } from "./profile";
import { normalizeCategories, redirectTargetOf, templateTitle } from "./refs";
import { headingDepth } from "./sections";
import { isBlankValue, paramMetaOf, templateArgsOf } from "./template-params";
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
 *  - 틀 자리에 틀 본문을 끼워 넣고 값 자리를 이름 값으로 채운다. 값이 모두 빈 표 행은 숨긴다.
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

/**
 * 틀 하나를 펼칠 때의 값. `values`는 쓰는 문서가 넘긴 값(이름 → inline 노드), `defaults`는 틀 문서의
 * 기본값이다.
 */
interface Scope {
  values: ReadonlyMap<string, readonly WikiNode[]>;
  defaults: ReadonlyMap<string, string>;
}

/** 노드를 복사하면서 안쪽의 틀을 펼치고 각주에 번호를 붙인다. */
function prepare(
  node: WikiNode,
  context: Context,
  stack: readonly string[],
  scope?: Scope,
): WikiNode {
  if (node.type === NODE.footnote) {
    // 각주 안에는 각주가 없으므로 안을 채운 뒤에 번호를 받아도 순서가 같다.
    const content = prepareContent(node.content ?? [], context, stack, scope);
    const number = context.footnotes.length + 1;
    context.footnotes.push({ number, content });
    return { ...node, attrs: { ...node.attrs, number }, content };
  }
  if (!node.content) return node;
  return {
    ...node,
    content: prepareContent(node.content, context, stack, scope),
  };
}

function prepareContent(
  nodes: readonly WikiNode[],
  context: Context,
  stack: readonly string[],
  scope?: Scope,
): WikiNode[] {
  const content: WikiNode[] = [];
  for (const child of nodes) {
    if (child.type === NODE.template) {
      content.push(...expandTemplate(child, context, stack, scope));
      continue;
    }
    if (scope && child.type === NODE.templateParam) {
      content.push(...fillParam(child, scope));
      continue;
    }
    // 값 자리가 있는데 값이 모두 빈 표 행은 그리지 않는다(정보 상자의 빈 줄). 틀 문서 자체를 볼
    // 때(`scope` 없음)는 모든 행을 보인다.
    if (scope && child.type === NODE.tableRow && isEmptyRow(child, scope)) {
      continue;
    }
    const prepared = prepare(child, context, stack, scope);
    // 행이 모두 숨은 표는 그리지 않는다.
    if (scope && prepared.type === NODE.table && !prepared.content?.length) {
      continue;
    }
    content.push(prepared);
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
  outer?: Scope,
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

  // 틀 안에서 다른 틀을 부를 때 값에 값 자리를 넣으면 바깥 틀이 받은 값을 넘긴다.
  const values = new Map<string, readonly WikiNode[]>();
  for (const [name, value] of templateArgsOf(node)) {
    values.set(name, outer ? substitute(value, outer) : value);
  }
  const template = asWikiDoc(body);
  const defaults = new Map<string, string>();
  for (const [name, meta] of Object.entries(paramMetaOf(template))) {
    if (meta.default) defaults.set(name, meta.default);
  }
  return prepareContent(template.content, context, [...stack, key], {
    values,
    defaults,
  });
}

/** 값 안의 값 자리를 바깥 틀이 받은 값으로 바꾼다. */
function substitute(nodes: readonly WikiNode[], scope: Scope): WikiNode[] {
  return nodes.flatMap((node) =>
    node.type === NODE.templateParam ? fillParam(node, scope) : [node],
  );
}

/** 값 자리에 들어갈 노드. 값이 비면 기본값, 기본값도 없으면 아무것도 없다. */
function resolveParam(name: string, scope: Scope): readonly WikiNode[] {
  const value = scope.values.get(name);
  if (!isBlankValue(value)) return value!;
  const fallback = scope.defaults.get(name);
  return fallback ? [{ type: NODE.text, text: fallback }] : [];
}

/**
 * 값 자리를 값으로 채운다. 틀 작성자가 그 자리에 건 꾸밈(굵게, 색 등)은 값에도 건다. 값에 링크가
 * 있으면 작성자의 링크는 빼고 값의 링크를 쓴다. 같은 종류의 꾸밈은 값의 것을 쓴다.
 */
function fillParam(node: WikiNode, scope: Scope): WikiNode[] {
  const value = resolveParam(stringAttr(node, "name"), scope);
  const outer = node.marks ?? [];
  return value.map((item) => {
    if (item.type !== NODE.text || outer.length === 0) return item;
    const own = item.marks ?? [];
    const linked = own.some(isLinkMark);
    const kept = outer.filter(
      (mark) =>
        !own.some((mine) => mine.type === mark.type) &&
        !(linked && isLinkMark(mark)),
    );
    return kept.length > 0 ? { ...item, marks: [...kept, ...own] } : item;
  });
}

function isLinkMark(mark: WikiMark): boolean {
  return mark.type === MARK.link || mark.type === MARK.wikiLink;
}

/** 값 자리가 있고, 그 값이 모두 비었는가(기본값도 없음). */
function isEmptyRow(row: WikiNode, scope: Scope): boolean {
  const names: string[] = [];
  walk(row.content ?? [], (node) => {
    if (node.type === NODE.templateParam) names.push(stringAttr(node, "name"));
  });
  return (
    names.length > 0 &&
    names.every((name) => resolveParam(name, scope).length === 0)
  );
}
