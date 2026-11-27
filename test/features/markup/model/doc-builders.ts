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
  content: typeof note === "string" ? [text(note)] : note,
});

/** 이미지·영상의 캡션 노드(`content`에 넣는다). 내용이 없으면 빈 캡션. */
export const caption = (...content: (string | WikiNode)[]): WikiNode[] => [
  content.length > 0
    ? {
        type: "caption",
        content: content.map((item) =>
          typeof item === "string" ? text(item) : item,
        ),
      }
    : { type: "caption" },
];

/** 틀 끼워 넣기. 값은 이름 → 글자(글자 노드 하나) 또는 inline 노드 목록. */
export const template = (
  name: string,
  args: Record<string, string | WikiNode[]> = {},
): WikiNode => {
  const content = Object.entries(args).map(([argName, value]) => ({
    type: "templateArg",
    attrs: { name: argName },
    content: typeof value === "string" ? [text(value)] : value,
  }));
  return content.length > 0
    ? { type: "template", attrs: { name }, content }
    : { type: "template", attrs: { name } };
};

export const param = (name: string): WikiNode => ({
  type: "templateParam",
  attrs: { name },
});

export const doc = (...content: WikiNode[]): WikiDoc => ({
  type: "doc",
  content,
});
