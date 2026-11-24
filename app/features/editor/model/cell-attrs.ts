import type { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";

import { NODE } from "~/features/markup";

/** 고른 칸들의 값이 서로 다르다는 표시(`activeCellAttr`, `ColorPicker`). */
export const MIXED: unique symbol = Symbol("mixed");

/**
 * 고른 칸의 셀 속성 값. 칸을 여러 개 골랐으면 전부 읽고, 값이 서로 다르면 `MIXED`를 돌려준다. 그러면
 * 단추는 켜짐 표시를 끄고 기본 아이콘을 보인다. 여러 개를 고르지 않았으면 커서가 있는 칸(제목 칸이나
 * 보통 칸)의 값이다.
 */
export function activeCellAttr(editor: Editor, name: string): unknown {
  const { selection } = editor.state;
  if (!(selection instanceof CellSelection)) {
    return editor.getAttributes(
      editor.isActive(NODE.tableHeader) ? NODE.tableHeader : NODE.tableCell,
    )[name];
  }
  const values = new Set<unknown>();
  selection.forEachCell((cell) => {
    values.add(cell.attrs[name]);
  });
  return values.size > 1 ? MIXED : values.values().next().value;
}

/**
 * 셀 속성을 고른 칸 전부에 건다. 칸을 여러 개 고르지 않았으면 커서가 있는 칸에 건다. 팝오버나 메뉴가
 * 초점을 가져가도 편집기의 선택(고른 칸)은 남으므로 초점을 편집기로 되돌리지 않는다.
 */
export function setCellAttr(
  editor: Editor,
  name: string,
  value: string | null,
): boolean {
  return editor.commands.command(({ commands, tr }) => {
    const { selection } = tr;
    if (!(selection instanceof CellSelection)) {
      return commands.setCellAttribute(name, value);
    }
    selection.forEachCell((cell, pos) => {
      if (cell.attrs[name] !== value) {
        tr.setNodeMarkup(pos, undefined, { ...cell.attrs, [name]: value });
      }
    });
    return true;
  });
}
