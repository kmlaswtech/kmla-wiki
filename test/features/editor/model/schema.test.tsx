import { Editor } from "@tiptap/core";
import { DOMParser } from "@tiptap/pm/model";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import {
  caption,
  doc,
  footnote,
  link,
  para,
  text,
} from "../../markup/model/doc-builders";
import {
  footnoteText,
  schemaExtensions,
  wikiSchema,
} from "~/features/editor/model/schema";
import { WikiContent, type WikiDoc, type WikiNode } from "~/features/markup";
import { parseWiki } from "~/features/markup/model/parse";

describe("Footnote", () => {
  it("restores the content when a footnote is copied from the page view", () => {
    const content = [
      text("출처: "),
      {
        type: "text",
        text: "규정",
        marks: [{ type: "bold" }],
      },
      text(" "),
      link("학사 규정"),
    ];
    const { container } = render(
      <MemoryRouter>
        <WikiContent
          document={parseWiki(doc(para(text("본문"), footnote(content))))}
          existing={new Set()}
        />
      </MemoryRouter>,
    );
    const paragraph = container.querySelector("p")!;

    const pasted = DOMParser.fromSchema(wikiSchema()).parse(paragraph);
    const note = pasted.firstChild!.child(1);
    expect(note.type.name).toBe("footnote");
    expect(note.content.toJSON()).toEqual(content);
  });

  it("drops unsafe marks and block nodes from pasted footnote content", () => {
    const sup = document.createElement("sup");
    sup.setAttribute("data-footnote", "");
    sup.setAttribute(
      "data-footnote-content",
      JSON.stringify([
        {
          type: "text",
          text: "x",
          marks: [
            { type: "link", attrs: { href: "javascript:alert(1)" } },
            { type: "textSize", attrs: { size: 99 } },
            { type: "bold" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "블록" }] },
      ]),
    );
    const holder = document.createElement("p");
    holder.append(sup);

    const pasted = DOMParser.fromSchema(wikiSchema()).parse(holder);
    // 꾸밈은 안전한 것만 남고, 블록은 풀려 글자만 남는다.
    expect(pasted.firstChild!.firstChild!.content.toJSON()).toEqual([
      { type: "text", text: "x", marks: [{ type: "bold" }] },
      { type: "text", text: "블록" },
    ]);
  });

  it("joins lines with a space in the footnote text", () => {
    const schema = wikiSchema();
    const note = schema.nodes.footnote!.create(null, [
      schema.text("A"),
      schema.nodes.hardBreak!.create(),
      schema.text("B"),
    ]);
    expect(footnoteText(note)).toBe("A B");
  });
});

describe("MediaCaption", () => {
  const IMAGE_ID = "0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a";
  let editor: Editor | undefined;
  afterEach(() => editor?.destroy());

  function open(content: WikiDoc): Editor {
    editor = new Editor({ extensions: schemaExtensions(), content });
    return editor;
  }

  const imageWith = (...content: (string | WikiNode)[]): WikiNode => ({
    type: "image",
    attrs: { id: IMAGE_ID },
    content: caption(...content),
  });

  /** 캡션 글자 안(`offset`번째 글자 뒤)에 커서를 둔다. 문서 맨 앞이 그림이라고 본다. */
  function cursorInCaption(current: Editor, offset: number) {
    current.commands.setTextSelection(2 + offset);
    expect(current.state.selection.$from.parent.type.name).toBe("caption");
  }

  const types = (current: Editor) =>
    (current.getJSON().content ?? []).map((node) => node.type);

  it("restores a styled caption with a footnote copied from the page view", () => {
    const content = [
      { type: "text", text: "본관", marks: [{ type: "bold" }] },
      text(" "),
      link("학교"),
      footnote("출처"),
    ];
    const { container } = render(
      <MemoryRouter>
        <WikiContent
          document={parseWiki(doc(imageWith(...content)))}
          existing={new Set()}
          renderImage={(_id, alt) => <img alt={alt} />}
        />
      </MemoryRouter>,
    );
    const pasted = DOMParser.fromSchema(wikiSchema()).parse(container);
    const image = pasted.firstChild!;
    expect(image.type.name).toBe("image");
    expect(image.childCount).toBe(1);
    expect(image.firstChild!.content.toJSON()).toEqual(content);
  });

  it("reads a figcaption outside a picture as plain text", () => {
    const holder = document.createElement("div");
    holder.innerHTML = "<figure><figcaption>다른 사이트</figcaption></figure>";
    const pasted = DOMParser.fromSchema(wikiSchema()).parse(holder);
    expect(pasted.childCount).toBe(1);
    expect(pasted.firstChild!.type.name).toBe("paragraph");
    expect(pasted.textContent).toBe("다른 사이트");
  });

  it("does not split the picture when a block is inserted in the caption", () => {
    const current = open(doc(imageWith("본관 앞"), para()));
    cursorInCaption(current, 2);
    current.commands.insertContent({ type: "horizontalRule" });
    current.commands.insertTable({ rows: 2, cols: 2 });
    expect(types(current)).toEqual(["image", "paragraph"]);
    expect(current.getText()).toContain("본관 앞");
  });

  it("puts a block under the picture when the toolbar leaves the caption first", () => {
    const current = open(doc(imageWith("본관"), para(text("뒤"))));
    cursorInCaption(current, 1);
    current
      .chain()
      .leaveCaption()
      .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
      .run();
    expect(types(current)).toEqual(["image", "table", "paragraph"]);
  });

  it("does not turn the caption into a heading or a list", () => {
    const current = open(doc(imageWith("본관"), para()));
    cursorInCaption(current, 1);
    current.commands.toggleHeading({ level: 2 });
    current.commands.toggleBulletList();
    current.commands.toggleBlockquote();
    expect(types(current)).toEqual(["image", "paragraph"]);
  });

  it("lets text, marks, links and footnotes into the caption", () => {
    const current = open(doc(imageWith("본관"), para()));
    cursorInCaption(current, 2);
    current.commands.insertContent([
      text(" 앞"),
      { type: "footnote", content: [text("출처")] },
    ]);
    current.commands.setTextSelection({ from: 2, to: 4 });
    current.commands.toggleBold();
    expect(current.getJSON().content?.[0]?.content).toEqual(
      caption(
        { type: "text", text: "본관", marks: [{ type: "bold" }] },
        " 앞",
        footnote("출처"),
      ),
    );
  });

  it("moves to a new paragraph under the picture on Enter", () => {
    const current = open(doc(imageWith("본관"), para(text("뒤"))));
    cursorInCaption(current, 2);
    // `keyboardShortcut` 명령은 선택을 옮기지 않으므로 키 처리기를 바로 부른다.
    const enter = new KeyboardEvent("keydown", { key: "Enter" });
    current.view.someProp("handleKeyDown", (handle) =>
      handle(current.view, enter),
    );
    expect(types(current)).toEqual(["image", "paragraph", "paragraph"]);
    expect(current.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(current.state.selection.$from.index(0)).toBe(1);
  });

  it("joins pasted paragraphs into one caption line by line", () => {
    const current = open(doc(imageWith(), para()));
    cursorInCaption(current, 0);
    // jsdom에는 ClipboardEvent가 없어 붙여넣기 처리기를 바로 부른다.
    const holder = document.createElement("div");
    holder.innerHTML = "<p>첫 줄</p><h2>둘째</h2><ul><li><p>셋</p></li></ul>";
    const slice = DOMParser.fromSchema(current.schema).parseSlice(holder);
    current.view.someProp("handlePaste", (handle) =>
      handle(current.view, new Event("paste") as ClipboardEvent, slice),
    );
    expect(types(current)).toEqual(["image", "paragraph"]);
    expect(current.getJSON().content?.[0]?.content).toEqual(
      caption(
        "첫 줄",
        { type: "hardBreak" },
        "둘째",
        { type: "hardBreak" },
        "셋",
      ),
    );
  });
});
