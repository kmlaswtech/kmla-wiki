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
import { parseWiki, WikiContent, type WikiDoc } from "~/features/markup";

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
