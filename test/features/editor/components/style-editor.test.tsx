import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { joinDoc, normalizeDoc } from "~/features/editor/model/doc-io";
import { schemaExtensions } from "~/features/editor/model/schema";
import { starterProfile, type WikiDoc, type WikiNode } from "~/features/markup";

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

function open(content: WikiDoc | string): Editor {
  editor = new Editor({ extensions: schemaExtensions(), content });
  return editor;
}

const json = (current: Editor) =>
  joinDoc(current.getJSON() as WikiDoc, { categories: [], profile: null });

function find(node: WikiNode, type: string): WikiNode | undefined {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const found = find(child, type);
    if (found) return found;
  }
  return undefined;
}

describe("editor styling", () => {
  it("does not save unset style attributes", () => {
    const current = open({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "글" }] }],
    });
    expect(json(current)).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "글" }] }],
    });
  });

  it("sets alignment, color and size", () => {
    const current = open("<p>글자</p>");
    current
      .chain()
      .selectAll()
      .updateAttributes("paragraph", { textAlign: "center" })
      .setMark("textColor", { color: "red" })
      .setMark("textSize", { size: 2 })
      .run();
    const paragraph = json(current).content[0]!;
    expect(paragraph.attrs).toEqual({ textAlign: "center" });
    expect(paragraph.content?.[0]?.marks).toEqual(
      expect.arrayContaining([
        { type: "textColor", attrs: { color: "red" } },
        { type: "textSize", attrs: { size: 2 } },
      ]),
    );
  });

  it("styles the selected cell with a background only", () => {
    const current = open("<p></p>");
    current.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    current.chain().setCellAttribute("background", "green").run();
    const table = find(
      { type: "doc", content: json(current).content },
      "table",
    )!;
    expect(table.attrs).toBeUndefined();
    expect(find(table, "tableHeader")?.attrs).toMatchObject({
      background: "green",
    });
  });

  it("has no cell alignment; text in cells uses paragraph alignment", () => {
    const current = open(
      '<table><tbody><tr><td style="text-align: right" align="right"><p>칸</p></td></tr></tbody></table>',
    );
    const cell = find(json(current).content[0]!, "tableCell")!;
    expect(cell.attrs).not.toHaveProperty("align");
  });

  it("keeps styling when copied from the page view, but drops foreign colors", () => {
    const current = open(
      '<p data-text-align="right"><span class="wiki-color" data-text-color="blue">파랑</span>' +
        '<span style="color: #ff0">노랑</span></p>' +
        '<table><tbody><tr><td data-bg="red-strong">칸</td></tr></tbody></table>',
    );
    const body = json(current);
    expect(body.content[0]?.attrs).toEqual({ textAlign: "right" });
    expect(body.content[0]?.content?.[0]?.marks).toEqual([
      { type: "textColor", attrs: { color: "blue" } },
    ]);
    expect(body.content[0]?.content?.[1]?.marks).toBeUndefined();
    expect(find(body.content[1]!, "tableCell")?.attrs).toMatchObject({
      background: "red-strong",
    });
  });

  it("keeps the profile as editor blocks and reads it back the same", () => {
    const joined = joinDoc(
      { type: "doc", content: [{ type: "paragraph" }] },
      { categories: [], profile: starterProfile() },
    );
    const profile = joined.attrs?.profile as WikiNode[];
    expect(profile).toHaveLength(1);
    expect(find(profile[0]!, "tableHeader")?.attrs).toMatchObject({
      colspan: 2,
      background: "blue-strong",
    });
    // 저장한 값을 다시 읽어 합쳐도 같다(편집 화면이 "바뀐 것이 없다"고 안다).
    expect(JSON.stringify(normalizeDoc(joined))).toBe(JSON.stringify(joined));
  });

  it("does not save an empty profile", () => {
    const joined = joinDoc(
      { type: "doc", content: [{ type: "paragraph" }] },
      { categories: [], profile: [{ type: "paragraph" }] },
    );
    expect(joined.attrs).toBeUndefined();
  });
});
