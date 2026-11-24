import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";

import {
  activeCellAttr,
  MIXED,
  setCellAttr,
} from "~/features/editor/model/cell-attrs";
import { joinDoc } from "~/features/editor/model/doc-io";
import { schemaExtensions } from "~/features/editor/model/schema";
import type { WikiDoc, WikiNode } from "~/features/markup";

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

/** 2×2 표를 만들고 칸(제목 칸 포함)을 모두 고른다. 칸 위치를 문서 순서로 돌려준다. */
function table(withHeaderRow: boolean): { current: Editor; cells: number[] } {
  const current = new Editor({ extensions: schemaExtensions(), content: "" });
  editor = current;
  current.commands.insertTable({ rows: 2, cols: 2, withHeaderRow });
  const cells: number[] = [];
  current.state.doc.descendants((node, pos) => {
    if (node.type.name === "tableHeader" || node.type.name === "tableCell") {
      cells.push(pos);
    }
  });
  selectAllCells(current, cells);
  return { current, cells };
}

function selectAllCells(current: Editor, cells: number[]) {
  current.view.dispatch(
    current.state.tr.setSelection(
      CellSelection.create(current.state.doc, cells[0]!, cells.at(-1)),
    ),
  );
}

/** 저장할 문서의 칸들. */
function savedCells(current: Editor): WikiNode[] {
  const body = joinDoc(current.getJSON() as WikiDoc, {
    categories: [],
    profile: null,
  });
  const rows = body.content.find((node) => node.type === "table")?.content;
  return (rows ?? []).flatMap((row) => row.content ?? []);
}

describe("setCellAttr", () => {
  it("aligns every selected cell, then clears them without saving null", () => {
    const { current } = table(false);
    setCellAttr(current, "verticalAlign", "bottom");
    expect(
      savedCells(current).map((cell) => cell.attrs?.verticalAlign),
    ).toEqual(["bottom", "bottom", "bottom", "bottom"]);
    setCellAttr(current, "verticalAlign", null);
    for (const cell of savedCells(current)) {
      expect(cell.attrs).not.toHaveProperty("verticalAlign");
    }
  });
});

describe("activeCellAttr", () => {
  function aligned() {
    const made = table(true);
    setCellAttr(made.current, "verticalAlign", "middle");
    return made;
  }

  it("shows the value every selected cell shares", () => {
    const { current } = aligned();
    expect(activeCellAttr(current, "verticalAlign")).toBe("middle");
    expect(activeCellAttr(current, "background")).toBeNull();
  });

  it("shows mixed, not the first cell, when the values differ", () => {
    const { current, cells } = aligned();
    current.commands.setTextSelection(cells[0]! + 2);
    setCellAttr(current, "verticalAlign", "bottom");
    setCellAttr(current, "background", "yellow");
    selectAllCells(current, cells);
    expect(activeCellAttr(current, "verticalAlign")).toBe(MIXED);
    expect(activeCellAttr(current, "background")).toBe(MIXED);
  });

  it("reads the cell with the cursor when no cells are selected", () => {
    const { current, cells } = aligned();
    current.commands.setTextSelection(cells.at(-1)! + 2);
    setCellAttr(current, "background", "yellow");
    expect(activeCellAttr(current, "background")).toBe("yellow");
    expect(activeCellAttr(current, "verticalAlign")).toBe("middle");
  });
});
