import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import {
  doc,
  footnote,
  heading,
  link,
  para,
  text,
} from "../model/doc-builders";
import {
  docToText,
  parseWiki,
  WikiContent,
  type WikiDoc,
} from "~/features/markup";

function show(
  body: WikiDoc,
  existing: ReadonlySet<string> = new Set(),
  withToc = false,
) {
  return render(
    <MemoryRouter>
      <WikiContent
        document={parseWiki(body)}
        existing={existing}
        withToc={withToc}
      />
    </MemoryRouter>,
  );
}

/** 손가락이나 마우스로 누른다. jsdom에는 `PointerEvent`가 없어 종류를 직접 붙인다. */
function tap(element: Element, pointerType: "touch" | "mouse") {
  const down = new MouseEvent("pointerdown", { bubbles: true });
  Object.defineProperty(down, "pointerType", { value: pointerType });
  fireEvent(element, down);
  fireEvent.click(element);
}

const external = (label: string, href: string) => ({
  type: "text",
  text: label,
  marks: [{ type: "link", attrs: { href } }],
});

describe("WikiContent", () => {
  it("draws formatting as elements", () => {
    const { container } = show(
      doc(
        para(
          { type: "text", text: "굵게", marks: [{ type: "bold" }] },
          { type: "text", text: "밑줄", marks: [{ type: "underline" }] },
          { type: "text", text: "취소", marks: [{ type: "strike" }] },
        ),
      ),
    );
    expect(container.querySelector("strong")).toHaveTextContent("굵게");
    expect(container.querySelector("u")).toHaveTextContent("밑줄");
    expect(container.querySelector("s, del")).toHaveTextContent("취소");
  });

  it("shows text that looks like HTML as text", () => {
    const { container } = show(doc(para(text("<script>alert(1)</script>"))));
    expect(container.querySelector("script")).toBeNull();
    expect(container).toHaveTextContent("<script>alert(1)</script>");
  });

  it("links only safe external addresses", () => {
    show(
      doc(
        para(
          external("나쁨", "javascript:alert(1)"),
          external("좋음", "https://kmla.online"),
          external("메일", "mailto:a@b.c"),
        ),
      ),
    );
    expect(screen.queryByRole("link", { name: "나쁨" })).toBeNull();
    expect(screen.getByText("나쁨")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "좋음" })).toHaveAttribute(
      "href",
      "https://kmla.online",
    );
    expect(screen.getByRole("link", { name: "메일" })).toHaveAttribute(
      "href",
      "mailto:a@b.c",
    );
  });

  it("marks links to missing pages and keeps links to existing ones plain", () => {
    show(
      doc(para(link("신성"), text(" "), link("없는 문서", "없음"))),
      new Set(["신성"]),
    );
    expect(screen.getByRole("link", { name: "신성" })).not.toHaveClass(
      "wiki-link-missing",
    );
    expect(screen.getByRole("link", { name: "없음" })).toHaveClass(
      "wiki-link-missing",
    );
  });

  it("does not draw nodes it does not know", () => {
    const { container } = show(
      doc(para(text("글")), { type: "iframe", attrs: { src: "https://x" } }),
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(container).toHaveTextContent("글");
  });

  it("wraps sections and collects footnotes at the bottom", () => {
    const { container } = show(
      doc(
        heading(2, "가"),
        para(text("본문"), footnote("출처 https://kmla.online")),
      ),
      new Set(),
      true,
    );
    expect(container.querySelector("[data-wiki-section] h2")).toHaveTextContent(
      "가",
    );
    const notes = container.querySelector("section[data-footnotes]");
    expect(notes).toHaveTextContent("출처");
    expect(
      notes?.querySelector('a[href="https://kmla.online"]'),
    ).not.toBeNull();
  });

  it("leaves out the footnote list and ids when embedded in another view", () => {
    const { container } = render(
      <MemoryRouter>
        <WikiContent
          document={parseWiki(
            doc(heading(2, "가"), para(text("본문"), footnote("주석"))),
          )}
          existing={new Set()}
          embedded
        />
      </MemoryRouter>,
    );
    expect(container.querySelector("section[data-footnotes]")).toBeNull();
    expect(container.querySelector("[id]")).toBeNull();
    expect(screen.getByRole("button", { name: "각주 1" })).toBeInTheDocument();
  });

  it("lifts the strike line on a finger tap, but not on a mouse click or a link", () => {
    const { container } = show(
      doc(
        para(
          { type: "text", text: "취소", marks: [{ type: "strike" }] },
          {
            type: "text",
            text: "링크",
            marks: [
              { type: "strike" },
              { type: "link", attrs: { href: "https://kmla.online" } },
            ],
          },
        ),
      ),
    );
    const [plain, linked] = container.querySelectorAll("s");
    tap(plain!, "mouse");
    expect(plain).not.toHaveAttribute("data-revealed");
    tap(plain!, "touch");
    expect(plain).toHaveAttribute("data-revealed");
    tap(plain!, "touch");
    expect(plain).not.toHaveAttribute("data-revealed");
    tap(linked!, "touch");
    expect(linked).not.toHaveAttribute("data-revealed");
  });

  it("plays YouTube videos from the no-cookie address with their layout", () => {
    const { container } = show(
      doc(
        {
          type: "youtube",
          attrs: {
            videoId: "dQw4w9WgXcQ",
            start: 90,
            size: "small",
            align: "center",
          },
        },
        { type: "youtube", attrs: { videoId: 'x" onload="alert(1)' } },
      ),
    );
    const frames = container.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90",
    );
    const figure = container.querySelector("figure[data-youtube]");
    expect(figure).toHaveAttribute("data-size", "small");
    expect(figure).toHaveAttribute("data-align", "center");
  });

  it("gives images their chosen layout", () => {
    const { container } = show(
      doc({
        type: "image",
        attrs: {
          id: "0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a",
          alt: "지도",
          size: "full",
          align: "right",
        },
      }),
    );
    const figure = container.querySelector("figure[data-wiki-image]");
    expect(figure).toHaveAttribute("data-size", "full");
    expect(figure).toHaveAttribute("data-align", "right");
  });

  it("shows a caption under images and videos only when there is one", () => {
    const { container } = show(
      doc(
        {
          type: "image",
          attrs: { id: "0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a", caption: "" },
        },
        {
          type: "youtube",
          attrs: { videoId: "dQw4w9WgXcQ", caption: "학교 소개" },
        },
      ),
    );
    const captions = container.querySelectorAll("figcaption");
    expect(captions).toHaveLength(1);
    expect(captions[0]).toHaveTextContent("학교 소개");
    expect(
      container.querySelector("figure[data-youtube] figcaption"),
    ).not.toBeNull();
  });
});

describe("WikiContent styling", () => {
  const colored = (value: string, color: string) => ({
    type: "text",
    text: value,
    marks: [{ type: "textColor", attrs: { color } }],
  });

  it("draws palette and custom text colors as CSS variables", () => {
    const { container } = show(
      doc(para(colored("빨강", "red"), colored("직접", "#112233,#ddeeff"))),
    );
    const [red, custom] = container.querySelectorAll(".wiki-color");
    expect(red).toHaveAttribute("data-text-color", "red");
    expect(red?.getAttribute("style")).toContain("var(--wiki-text-red)");
    expect(custom?.getAttribute("style")).toContain("--wiki-fg-dark: #ddeeff");
  });

  it("drops values that are not checked", () => {
    const { container } = show(
      doc(para(colored("글", "red; background: url(x)")), {
        type: "paragraph",
        attrs: { textAlign: "justify" },
        content: [text("a")],
      }),
    );
    expect(container.querySelector(".wiki-color")).toBeNull();
    expect(container.querySelector("p[style]")).toBeNull();
  });

  it("draws text size, paragraph alignment and table styling", () => {
    const { container } = show(
      doc(
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [
            {
              type: "text",
              text: "큰 글",
              marks: [{ type: "textSize", attrs: { size: 2 } }],
            },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: {
                    colspan: 2,
                    align: "center",
                    background: "blue-strong",
                  },
                  content: [para(text("이름"))],
                },
              ],
            },
          ],
        },
      ),
    );
    expect(container.querySelector("p")).toHaveStyle({ textAlign: "center" });
    expect(container.querySelector("[data-text-size='2']")).toHaveTextContent(
      "큰 글",
    );
    const th = container.querySelector("th");
    expect(th).toHaveAttribute("colspan", "2");
    expect(th).toHaveAttribute("data-bg", "blue-strong");
    expect(th).toHaveAttribute("data-bg-strong", "");
    expect(th?.getAttribute("style")).toContain("var(--wiki-strong-blue)");
    // 칸 정렬은 없다(칸 안의 글은 문단 정렬로 맞춘다). 예전 값이 남아 있어도 그리지 않는다.
    expect(th?.getAttribute("style")).not.toContain("text-align");
  });
});

describe("profile", () => {
  const profile = [
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              attrs: { colspan: 2, background: "blue-strong" },
              content: [para(text("민족사관고등학교"))],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [para(text("개교"))] },
            {
              type: "tableCell",
              content: [para(text("1996년"), footnote("출처"))],
            },
          ],
        },
      ],
    },
    para(link("역사")),
  ];

  it("draws the profile with the table of contents beside it, then the body", () => {
    const { container } = render(
      <MemoryRouter>
        <WikiContent
          withToc
          document={parseWiki({
            type: "doc",
            attrs: { profile },
            content: [heading(2, "개요"), para(text("본문"), footnote("둘째"))],
          })}
          existing={new Set()}
          beforeBody={<nav data-testid="toc" />}
        />
      </MemoryRouter>,
    );
    const box = screen.getByRole("complementary", { name: "프로필" });
    expect(box.querySelector("th[colspan='2']")).toHaveAttribute(
      "data-bg",
      "blue-strong",
    );
    expect(screen.getByRole("link", { name: "역사" })).toHaveClass(
      "wiki-link-missing",
    );
    // 프로필 → 목차 → 본문 순서. 띄우지 않으므로 본문은 프로필이 끝난 뒤에 온다.
    const toc = screen.getByTestId("toc");
    const body = screen.getByText("본문");
    expect(box.compareDocumentPosition(toc)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(toc.compareDocumentPosition(body)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // 각주 번호는 보이는 순서대로 프로필부터 매긴다.
    const notes = container.querySelectorAll("section[data-footnotes] li");
    expect([...notes].map((note) => note.textContent)).toEqual([
      "[1]출처",
      "[2]둘째",
    ]);
  });

  it("does not draw the profile of a template preview", () => {
    render(
      <MemoryRouter>
        <WikiContent
          embedded
          document={parseWiki({ type: "doc", attrs: { profile }, content: [] })}
          existing={new Set()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("ignores broken values and empty profiles", () => {
    expect(
      parseWiki({ type: "doc", attrs: { profile: "x" }, content: [] }).profile,
    ).toBeNull();
    expect(
      parseWiki({
        type: "doc",
        attrs: { profile: [para()] },
        content: [],
      }).profile,
    ).toBeNull();
    expect(
      parseWiki({
        type: "doc",
        attrs: { profile: [3, para(text("a"))] },
        content: [],
      }).profile,
    ).toEqual([para(text("a"))]);
  });

  it("shows profile and styling changes in the diff text", () => {
    const body = {
      type: "doc" as const,
      attrs: { profile: [para(text("민사고"), link("역사"))] },
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [
            {
              type: "text",
              text: "글",
              marks: [{ type: "textColor", attrs: { color: "red" } }],
            },
          ],
        },
      ],
    };
    expect(docToText(body)).toBe(
      [
        "[프로필]",
        "민사고[[역사]]",
        "[/프로필]",
        "",
        "(가운데 정렬) {{{#빨강 글}}}",
      ].join("\n"),
    );
  });
});
