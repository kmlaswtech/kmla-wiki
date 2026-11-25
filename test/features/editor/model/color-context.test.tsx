import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";

import { setCellAttr } from "~/features/editor/model/cell-attrs";
import {
  backgroundsBehind,
  CAPTION_NODES,
  CELL_NODES,
  paletteHuesIn,
} from "~/features/editor/model/color-context";
import { schemaExtensions } from "~/features/editor/model/schema";

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

/** 문서 순서의 표 칸 위치. */
function cellPositions(current: Editor): number[] {
  const cells: number[] = [];
  current.state.doc.descendants((node, pos) => {
    if (node.type.name === "tableCell") cells.push(pos);
  });
  return cells;
}

/** 2×2 표를 만들고 첫 칸에 빨강 글자를 쓴 뒤 진한 빨강 배경을 건다. */
function redOnRed(): Editor {
  const current = new Editor({ extensions: schemaExtensions(), content: "" });
  editor = current;
  current.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false });
  const first = cellPositions(current)[0]!;
  current.commands.setTextSelection(first + 2);
  current.commands.insertContent("가");
  current.commands.setTextSelection({ from: first + 2, to: first + 3 });
  current.commands.setMark("textColor", { color: "red" });
  setCellAttr(current, "background", "red-strong");
  return current;
}

describe("color context", () => {
  it("reads the background behind the cursor and the palette text in it", () => {
    const current = redOnRed();
    expect(backgroundsBehind(current)).toEqual(["red-strong"]);
    expect(paletteHuesIn(current, CELL_NODES)).toEqual(["red"]);
    // 캡션 배경 단추는 표 칸을 보지 않는다.
    expect(paletteHuesIn(current, CAPTION_NODES)).toEqual([]);

    current.commands.setTextSelection(cellPositions(current)[1]! + 2);
    expect(backgroundsBehind(current)).toEqual([null]);
    expect(paletteHuesIn(current, CELL_NODES)).toEqual([]);
  });

  it("reads every selected cell, so mixed backgrounds are not lost", () => {
    const current = redOnRed();
    const cells = cellPositions(current);
    current.view.dispatch(
      current.state.tr.setSelection(
        CellSelection.create(current.state.doc, cells[0]!, cells.at(-1)),
      ),
    );
    expect(backgroundsBehind(current)).toEqual(["red-strong", null]);
    expect(paletteHuesIn(current, CELL_NODES)).toEqual(["red"]);
  });

  it("reads a caption background and the text in the caption", () => {
    const current = new Editor({
      extensions: schemaExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { id: "00000000-0000-4000-8000-000000000001" },
            content: [
              {
                type: "caption",
                attrs: { background: "blue-strong" },
                content: [
                  {
                    type: "text",
                    text: "설명",
                    marks: [{ type: "textColor", attrs: { color: "green" } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    editor = current;
    current.commands.setTextSelection(3);
    expect(current.state.selection.$from.parent.type.name).toBe("caption");
    expect(backgroundsBehind(current)).toEqual(["blue-strong"]);
    expect(paletteHuesIn(current, CAPTION_NODES)).toEqual(["green"]);
    expect(paletteHuesIn(current, CELL_NODES)).toEqual([]);
  });
});
