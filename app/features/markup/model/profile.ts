import { NODE, type WikiDoc, type WikiNode } from "./doc";
import { isEmptyParagraph } from "./sections";

/**
 * 프로필(나무위키의 프로필 표 자리). 본문과 같은 블록 노드 목록이고, 본문과 같은 편집기 기능(표,
 * 색, 크기, 그림, 링크)으로 만든다. 다른 것은 자리뿐이다. 본문 흐름 밖이라 분류처럼 문서
 * 속성(`attrs.profile`)에 둔다. 문서 보기는 목차와 본문보다 먼저 그린다.
 *
 * 모양은 DB(`private.check_body`)도 검사한다.
 */
export type WikiProfile = WikiNode[];

/** 블록이 하나도 없거나 빈 문단뿐이면 빈 프로필이다. 빈 프로필은 저장하지 않는다. */
export function isEmptyProfile(blocks: readonly WikiNode[]): boolean {
  return blocks.every(isEmptyParagraph);
}

/** 저장된 값에서 프로필을 읽는다. 배열이 아니거나 비어 있으면 `null`. 노드가 아닌 값은 버린다. */
export function profileOf(doc: WikiDoc): WikiProfile | null {
  const raw: unknown = doc.attrs?.profile;
  if (!Array.isArray(raw)) return null;
  const blocks = raw.filter(
    (node): node is WikiNode =>
      typeof node === "object" &&
      node !== null &&
      typeof (node as WikiNode).type === "string",
  );
  return isEmptyProfile(blocks) ? null : blocks;
}

function cell(
  type: string,
  content: WikiNode[],
  attrs: Record<string, unknown> = {},
): WikiNode {
  return {
    type,
    attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs },
    content: [{ type: NODE.paragraph, ...(content.length ? { content } : {}) }],
  };
}

/**
 * 프로필을 처음 넣을 때의 틀: 이름 칸(두 칸을 합친 진한 배경, 가운데)과 항목/값 줄. 보통 표라
 * 사용자가 줄·칸·색·글자를 마음대로 고친다.
 */
export function starterProfile(): WikiProfile {
  const title: WikiNode = {
    type: NODE.paragraph,
    attrs: { textAlign: "center" },
    content: [{ type: NODE.text, text: "이름" }],
  };
  const row = (label: string): WikiNode => ({
    type: NODE.tableRow,
    content: [
      cell(NODE.tableHeader, [{ type: NODE.text, text: label }], {
        background: "blue",
      }),
      cell(NODE.tableCell, []),
    ],
  });
  return [
    {
      type: NODE.table,
      content: [
        {
          type: NODE.tableRow,
          content: [
            {
              type: NODE.tableHeader,
              attrs: {
                colspan: 2,
                rowspan: 1,
                colwidth: null,
                background: "blue-strong",
              },
              content: [title],
            },
          ],
        },
        row("구분"),
        row("소속"),
        row("기간"),
      ],
    },
  ];
}
