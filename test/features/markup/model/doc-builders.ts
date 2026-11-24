import type { WikiDoc, WikiNode } from "~/features/markup";

/** 테스트에서 문서 JSON을 짧게 쓰는 도우미. */
export const text = (value: string): WikiNode => ({
  type: "text",
  text: value,
});

export const link = (
  target: string,
  label = target,
  section = "",
): WikiNode => ({
  type: "text",
  text: label,
  marks: [{ type: "wikiLink", attrs: { target, section } }],
});

export const para = (...content: WikiNode[]): WikiNode =>
  content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };

export const heading = (level: number, value: string): WikiNode => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});

/** 각주. 글자를 주면 글자 노드 하나가 내용이 된다. */
export const footnote = (note: string | WikiNode[]): WikiNode => ({
  type: "footnote",
  content:
    typeof note === "string"
      ? note
        ? [{ type: "text", text: note }]
        : []
      : note,
});

export const template = (name: string, args: string[] = []): WikiNode => ({
  type: "template",
  attrs: { name, args },
});

export const param = (index: number): WikiNode => ({
  type: "templateParam",
  attrs: { index },
});

export const doc = (...content: WikiNode[]): WikiDoc => ({
  type: "doc",
  content,
});
