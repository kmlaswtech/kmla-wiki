import { findParentNode, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

import { MARK, NODE, parseTextColor, type Hue } from "~/features/markup";

import { selectedCells } from "./cell-attrs";

/**
 * 색 고르기 창이 보정 알림(`contrast-notice.ts`)에 쓰는 선택 맥락: 글자 뒤에 깔린 배경과, 배경을 걸
 * 곳 안의 글자 색.
 */

/** 배경을 거는 노드. 셀 배경은 표 칸, 캡션 배경은 캡션에 건다. */
export const CELL_NODES: readonly string[] = [NODE.tableCell, NODE.tableHeader];
export const CAPTION_NODES: readonly string[] = [NODE.caption];
const BACKGROUND_NODES = new Set([...CELL_NODES, ...CAPTION_NODES]);

function backgroundOf(node: PMNode): string | null {
  const value: unknown = node.attrs.background;
  return typeof value === "string" ? value : null;
}

/**
 * 글자 색을 걸 곳 뒤에 깔린 셀·캡션 배경 값들(겹치지 않게). `null`은 배경이 없다는 뜻이다(본문 바탕).
 * 칸을 여러 개 골랐으면 칸마다 읽으므로 여럿일 수 있다. 커서만 있으면 배경이 있는 가장 가까운 칸·캡션
 * 하나다.
 */
export function backgroundsBehind(editor: Editor): (string | null)[] {
  const cells = selectedCells(editor);
  if (cells) return [...new Set(cells.map(backgroundOf))];
  const holder = findParentNode(
    (node) =>
      BACKGROUND_NODES.has(node.type.name) && backgroundOf(node) !== null,
  )(editor.state.selection);
  return [holder ? backgroundOf(holder.node) : null];
}

/**
 * 배경을 걸 노드(고른 칸 전부, 아니면 커서에서 가장 가까운 `types` 노드) 안의 팔레트 글자 색. 배경을
 * 고를 때 어떤 글자 색이 보정될지 미리 알리는 데 쓴다.
 */
export function paletteHuesIn(editor: Editor, types: readonly string[]): Hue[] {
  const cells = types.includes(NODE.tableCell) ? selectedCells(editor) : null;
  const nearest = cells
    ? undefined
    : findParentNode((node) => types.includes(node.type.name))(
        editor.state.selection,
      );
  const holders = cells ?? (nearest ? [nearest.node] : []);
  const hues = new Set<Hue>();
  for (const holder of holders) {
    holder.descendants((node) => {
      for (const mark of node.marks) {
        if (mark.type.name !== MARK.textColor) continue;
        const color = parseTextColor(mark.attrs.color);
        if (color?.kind === "palette") hues.add(color.hue);
      }
    });
  }
  return [...hues];
}
