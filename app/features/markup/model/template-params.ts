import { NODE, stringAttr, walk, type WikiDoc, type WikiNode } from "./doc";
import { profileOf } from "./profile";

/**
 * 틀의 이름 값.
 *
 * 틀 문서는 본문에 값 자리(`templateParam{name}`)를 두고, 쓰는 문서는 틀 노드의 자식
 * (`templateArg{name}`)으로 값을 넘긴다. 값은 글자뿐 아니라 꾸밈·링크·줄바꿈이 있는 inline 노드다.
 * 값을 노드로 두는 이유: 검색 글자(`private.doc_text`)와 링크 목록(`private.extract_refs`)이 본문처럼
 * 그대로 읽는다.
 *
 * 값 자리의 설명과 기본값은 틀 문서의 `attrs.params`에 둔다. 이름 목록은 본문의 값 자리가 정본이다.
 * DB `private.check_body`가 같은 규칙(이름 길이, 겹침, `params` 모양)을 검사한다.
 */

/** 값 이름의 최대 글자 수. DB와 같다. */
export const PARAM_NAME_MAX = 20;

/** 값 자리 하나의 설명과 기본값. 둘 다 그냥 글자다. */
export interface ParamMeta {
  hint?: string;
  default?: string;
}

export type ParamMetaMap = Record<string, ParamMeta>;

export interface TemplateParamInfo extends ParamMeta {
  name: string;
}

/** 쓸 수 있는 이름인가: 앞뒤 빈칸이 없고, 비지 않고, 20자 이하. */
export function isParamName(name: string): boolean {
  return (
    name !== "" && name === name.trim() && [...name].length <= PARAM_NAME_MAX
  );
}

/** 문서(프로필 포함)에 있는 값 자리 이름. 처음 나온 순서이고 겹치지 않는다. */
export function paramNamesOf(doc: WikiDoc): string[] {
  const names: string[] = [];
  const collect = (node: WikiNode) => {
    if (node.type !== NODE.templateParam) return;
    const name = stringAttr(node, "name");
    if (isParamName(name) && !names.includes(name)) names.push(name);
  };
  walk(profileOf(doc) ?? [], collect);
  walk(doc.content, collect);
  return names;
}

/** 저장된 `attrs.params`를 검사해 읽는다. 모양이 틀린 항목은 버린다. */
export function paramMetaOf(doc: WikiDoc): ParamMetaMap {
  const raw = doc.attrs?.params;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const result: ParamMetaMap = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!isParamName(name) || typeof value !== "object" || value === null) {
      continue;
    }
    const meta = cleanMeta(value as Record<string, unknown>);
    if (meta) result[name] = meta;
  }
  return result;
}

/** 빈 칸을 뺀 설명·기본값. 둘 다 비면 `null`. */
function cleanMeta(value: Record<string, unknown>): ParamMeta | null {
  const meta: ParamMeta = {};
  if (typeof value.hint === "string" && value.hint.trim() !== "") {
    meta.hint = value.hint.trim();
  }
  if (typeof value.default === "string" && value.default.trim() !== "") {
    meta.default = value.default.trim();
  }
  return meta.hint === undefined && meta.default === undefined ? null : meta;
}

/** 본문에 있는 이름만 남기고 빈 항목을 뺀다. 남는 것이 없으면 `null`(저장하지 않는다). */
export function pruneParamMeta(
  meta: ParamMetaMap,
  names: readonly string[],
): ParamMetaMap | null {
  const result: ParamMetaMap = {};
  for (const name of names) {
    const item = meta[name] ? cleanMeta({ ...meta[name] }) : null;
    if (item) result[name] = item;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** 틀 문서의 값 자리 목록(본문 순서)과 각각의 설명·기본값. */
export function templateParamsOf(doc: WikiDoc): TemplateParamInfo[] {
  const meta = paramMetaOf(doc);
  return paramNamesOf(doc).map((name) => ({ name, ...meta[name] }));
}

/** 틀 노드가 넘기는 값. 이름이 겹치면 앞의 것을 쓴다. */
export function templateArgsOf(node: WikiNode): Map<string, WikiNode[]> {
  const args = new Map<string, WikiNode[]>();
  for (const child of node.content ?? []) {
    if (child.type !== NODE.templateArg) continue;
    const name = stringAttr(child, "name");
    if (isParamName(name) && !args.has(name)) {
      args.set(name, child.content ?? []);
    }
  }
  return args;
}

/** 보이는 것이 없는 값인가(글자가 없거나 빈칸·줄바꿈뿐). 값 자리가 있으면 비지 않았다. */
export function isBlankValue(nodes: readonly WikiNode[] | undefined): boolean {
  return (nodes ?? []).every((node) =>
    node.type === NODE.text
      ? !node.text?.trim()
      : node.type === NODE.hardBreak ||
        (node.type !== NODE.templateParam && isBlankValue(node.content)),
  );
}
