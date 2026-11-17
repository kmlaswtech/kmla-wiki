import { describe, expect, it } from "vitest";

import {
  headingNumberMap,
  numberHeadings,
} from "~/features/markup/model/heading-number";

describe("heading numbers", () => {
  const h = (depth: number, index: number) => ({
    depth,
    text: `h${index}`,
    id: `h${index}`,
    index,
    sectionIndex: index,
  });

  it("numbers nested headings and counts skipped levels as one step", () => {
    const numbered = numberHeadings([
      h(2, 0),
      h(3, 1),
      h(5, 2),
      h(3, 3),
      h(2, 4),
    ]);
    expect(numbered.map((x) => x.number)).toEqual([
      "1",
      "1.1",
      "1.1.1",
      "1.2",
      "2",
    ]);
    expect(numbered.map((x) => x.level)).toEqual([1, 2, 3, 2, 1]);
  });

  it("gives no numbers when the table of contents is not drawn", () => {
    expect(headingNumberMap([h(2, 0), h(2, 1)])).toBeNull();
    expect(headingNumberMap([h(2, 0), h(3, 1), h(2, 2)])?.get(2)).toBe("2");
  });
});
