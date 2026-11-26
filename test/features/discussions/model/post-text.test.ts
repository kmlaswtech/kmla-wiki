import { describe, expect, it } from "vitest";

import { parsePostText } from "~/features/discussions/model/post-text";

describe("parsePostText", () => {
  it("keeps plain text as one segment", () => {
    expect(parsePostText("그냥 글\n둘째 줄")).toEqual([
      { type: "text", text: "그냥 글\n둘째 줄" },
    ]);
  });

  it("links wiki titles with and without a label", () => {
    expect(
      parsePostText("[[귀가]]와 [[귀가/정기 귀가|정기 귀가]] 참고"),
    ).toEqual([
      { type: "wiki", title: "귀가", label: "귀가" },
      { type: "text", text: "와 " },
      { type: "wiki", title: "귀가/정기 귀가", label: "정기 귀가" },
      { type: "text", text: " 참고" },
    ]);
  });

  it("links a section reference to the page", () => {
    expect(parsePostText("[[귀가#신청]]")).toEqual([
      { type: "wiki", title: "귀가", label: "귀가#신청" },
    ]);
  });

  it("leaves a link to an invalid title as text", () => {
    expect(parsePostText("[[/잘못]] 끝")).toEqual([
      { type: "text", text: "[[/잘못]] 끝" },
    ]);
  });

  it("links urls and drops trailing punctuation", () => {
    expect(parsePostText("여기 https://example.com/a. 그리고")).toEqual([
      { type: "text", text: "여기 " },
      { type: "url", href: "https://example.com/a" },
      { type: "text", text: ". 그리고" },
    ]);
  });

  it("keeps a closing parenthesis that belongs to the url", () => {
    expect(parsePostText("(https://en.wikipedia.org/wiki/A_(b))")).toEqual([
      { type: "text", text: "(" },
      { type: "url", href: "https://en.wikipedia.org/wiki/A_(b)" },
      { type: "text", text: ")" },
    ]);
  });

  it("does not link other schemes", () => {
    expect(parsePostText("javascript:alert(1)")).toEqual([
      { type: "text", text: "javascript:alert(1)" },
    ]);
  });
});
