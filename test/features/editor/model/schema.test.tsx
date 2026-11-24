import { DOMParser } from "@tiptap/pm/model";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import {
  doc,
  footnote,
  link,
  para,
  text,
} from "../../markup/model/doc-builders";
import { wikiSchema } from "~/features/editor/model/schema";
import { WikiContent } from "~/features/markup";
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
});
