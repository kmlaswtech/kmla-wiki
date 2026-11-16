/**
 * 본문에서 가리키는 것을 뽑는 규칙의 사례 표.
 *
 * DB의 `supabase/tests/extract_refs.test.sql`에 같은 사례가 있다. 서버(저장 시 역링크·분류·넘겨주기
 * 계산)와 화면(렌더링)이 같은 문법을 같게 읽는지 양쪽에서 확인한다. 한쪽을 고치면 다른 쪽도 고친다.
 *
 * `expected`는 `종류=대상`을 종류·대상 순으로 정렬해 공백으로 이은 것이다.
 */
export const REF_CASES: { name: string; body: string; expected: string }[] = [
  { name: "plain text", body: "그냥 글", expected: "" },
  { name: "a link", body: "[[신성]]", expected: "link=신성" },
  {
    name: "a link with a label",
    body: "[[덕고관/엘리베이터|중베]]",
    expected: "link=덕고관/엘리베이터",
  },
  {
    name: "a link to a section",
    body: "[[귀가#신청 방법]]",
    expected: "link=귀가",
  },
  {
    name: "a link to a section with a label",
    body: "[[귀가#신청|여기]]",
    expected: "link=귀가",
  },
  { name: "a same-page section link", body: "[[#문단]]", expected: "" },
  {
    name: "a normalized link target",
    body: "[[ 정기_귀가 ]]",
    expected: "link=정기 귀가",
  },
  {
    name: "duplicates",
    body: "[[신성]] 그리고 [[신성]]",
    expected: "link=신성 link=신성",
  },
  { name: "a category", body: "[[분류:생활]]", expected: "category=분류:생활" },
  {
    name: "a link to a category",
    body: "[[:분류:생활]]",
    expected: "link=분류:생활",
  },
  {
    name: "a template",
    body: "{{틀:오래된 정보}}",
    expected: "template=틀:오래된 정보",
  },
  {
    name: "a template with a value",
    body: "{{틀:상위 문서|외출·외박}}",
    expected: "template=틀:상위 문서",
  },
  { name: "a template parameter", body: "{{{1}}}", expected: "" },
  {
    name: "a template without the prefix",
    body: "{{오래된 정보}}",
    expected: "",
  },
  {
    name: "an uploaded image",
    body: "![지도](img:0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a)",
    expected: "image=0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a",
  },
  {
    name: "an external image",
    body: "![외부](https://example.com/a.png)",
    expected: "",
  },
  {
    name: "a redirect",
    body: "#넘겨주기 [[PRISM]]",
    expected: "link=PRISM redirect=PRISM",
  },
  {
    name: "a redirect after blank space",
    body: "\n  #넘겨주기 [[PRISM]]",
    expected: "link=PRISM redirect=PRISM",
  },
  {
    name: "a redirect that is not first",
    body: "글\n#넘겨주기 [[PRISM]]",
    expected: "link=PRISM",
  },
  {
    name: "inline code",
    body: "`[[코드]]` 와 [[진짜]]",
    expected: "link=진짜",
  },
  {
    name: "a fenced code block",
    body: "```\n[[코드]]\n{{틀:코드}}\n```\n[[진짜]]",
    expected: "link=진짜",
  },
  { name: "an invalid title", body: "[[나쁜<제목>]]", expected: "" },
  {
    name: "a labelled link inside a table",
    body: "| 이름 | 뜻 |\n| --- | --- |\n| [[덕고관/엘리베이터|중베]] | 가운데 |",
    expected: "link=덕고관/엘리베이터",
  },
];
