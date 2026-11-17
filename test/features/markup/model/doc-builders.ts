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

export const footnote = (note: string): WikiNode => ({
  type: "footnote",
  attrs: { note },
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
