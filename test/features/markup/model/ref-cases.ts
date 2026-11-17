import { doc, link, para, text } from "./doc-builders";
import type { WikiDoc } from "~/features/markup";

/**
 * 본문에서 가리키는 것을 뽑는 규칙의 사례 표.
 *
 * DB의 `supabase/tests/extract_refs.test.sql`에 같은 사례가 같은 JSON으로 있다. 서버(저장 시
 * 역링크·분류·넘겨주기 계산)와 화면이 같은 문서를 같게 읽는지 양쪽에서 확인한다. 한쪽을 고치면
 * 다른 쪽도 고친다.
 *
 * `expected`는 `종류=대상`을 종류·대상 순으로 정렬해 공백으로 이은 것이다.
 */

export const REF_CASES: { name: string; body: WikiDoc; expected: string }[] = [
  { name: "plain text", body: doc(para(text("그냥 글"))), expected: "" },
  { name: "a link", body: doc(para(link("신성"))), expected: "link=신성" },
  {
    name: "a link with a label",
    body: doc(para(link("덕고관/엘리베이터", "중베"))),
    expected: "link=덕고관/엘리베이터",
  },
  {
    name: "a link to a section",
    body: doc(para(link("귀가", "귀가", "신청 방법"))),
    expected: "link=귀가",
  },
  {
    name: "a same-page section link",
    body: doc(para(link("", "문단", "문단"))),
    expected: "",
  },
  {
    name: "a normalized link target",
    body: doc(para(link(" 정기_귀가 "))),
    expected: "link=정기 귀가",
  },
  {
    name: "duplicates",
    body: doc(para(link("신성"), text(" 그리고 "), link("신성"))),
    expected: "link=신성 link=신성",
  },
  {
    name: "an invalid title",
    body: doc(para(link("나쁜<제목>"))),
    expected: "",
  },
  {
    name: "a link nested in a list, quote and table",
    body: doc(
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [para(link("가"))] }],
      },
      { type: "blockquote", content: [para(link("나"))] },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableCell", content: [para(link("다", "ㄷ"))] }],
          },
        ],
      },
    ),
    expected: "link=가 link=나 link=다",
  },
  {
    name: "a link inside a fold",
    body: doc({
      type: "fold",
      attrs: { title: "더 보기" },
      content: [para(link("신성"))],
    }),
    expected: "link=신성",
  },
  {
    name: "categories",
    body: { ...doc(), attrs: { categories: ["분류:생활", "기숙사"] } },
    expected: "category=분류:기숙사 category=분류:생활",
  },
  {
    name: "an invalid category",
    body: { ...doc(), attrs: { categories: ["나쁜<분류>", ""] } },
    expected: "",
  },
  {
    name: "a template",
    body: doc({
      type: "template",
      attrs: { name: "틀:오래된 정보", args: [] },
    }),
    expected: "template=틀:오래된 정보",
  },
  {
    name: "a template without the prefix",
    body: doc({
      type: "template",
      attrs: { name: "상위 문서", args: ["외출·외박"] },
    }),
    expected: "template=틀:상위 문서",
  },
  {
    name: "a template parameter",
    body: doc(para({ type: "templateParam", attrs: { index: 1 } })),
    expected: "",
  },
  {
    name: "an uploaded image",
    body: doc({
      type: "image",
      attrs: { id: "0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a", alt: "지도" },
    }),
    expected: "image=0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a",
  },
  {
    name: "an image with a bad id",
    body: doc({ type: "image", attrs: { id: "../a.png", alt: "" } }),
    expected: "",
  },
  {
    name: "an external link",
    body: doc(
      para({
        type: "text",
        text: "학교",
        marks: [{ type: "link", attrs: { href: "https://kmla.hs.kr" } }],
      }),
    ),
    expected: "",
  },
  {
    name: "a redirect",
    body: { ...doc(para()), attrs: { redirect: "PRISM" } },
    expected: "link=PRISM redirect=PRISM",
  },
  {
    name: "an empty redirect",
    body: { ...doc(para()), attrs: { redirect: "" } },
    expected: "",
  },
  {
    name: "code is plain text",
    body: doc(
      { type: "codeBlock", content: [text("[[코드]] {{틀:코드}}")] },
      para({ type: "text", text: "[[가짜]]", marks: [{ type: "code" }] }),
    ),
    expected: "",
  },
];
