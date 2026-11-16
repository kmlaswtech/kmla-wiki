import { describe, expect, it } from "vitest";

import { titleMatchPattern } from "~/features/pages/model/hangul-match";

/** DB는 PostgreSQL 정규식으로 찾는다. 여기서 쓰는 문법(묶음, 범위, 이스케이프)은 JS와 같다. */
function matches(query: string, title: string): boolean {
  return new RegExp(titleMatchPattern(query)).test(title);
}

describe("titleMatchPattern: 조합 중인 마지막 글자", () => {
  it.each([
    // "신성"을 치는 동안 입력칸에 보이는 값 모두가 "신성"을 찾는다.
    ["ㅅ", "신성"],
    ["시", "신성"],
    ["신", "신성"],
    ["신ㅅ", "신성"],
    ["신서", "신성"],
    ["신성", "신성"],
    // 받침이 다음 글자로 넘어간다: "신" 다음에 ㅓ를 치면 "시너".
    ["신", "시너"],
    // 겹받침: "달" 다음에 ㄱ을 치면 "닭".
    ["달", "닭갈비"],
    // 겹받침이 다시 나뉜다: "닭" 다음에 ㅏ를 치면 "달가".
    ["닭", "달걀"],
    // 겹모음: "고" 다음에 ㅏ를 치면 "과".
    ["고", "과학"],
    ["구", "권리"],
    ["으", "의자"],
    // 제목 가운데에 있어도 찾는다.
    ["정기 귀", "귀가/정기 귀가"],
    // 한글이 아닌 글자는 그대로.
    ["prism", "prism 과제"],
  ])("%s → %s", (query, title) => {
    expect(matches(query, title)).toBe(true);
  });

  it.each([
    // 이미 친 글자는 바뀌지 않는다.
    ["신서", "신강"],
    ["신ㅅ", "신강"],
    // 받침이 있는 글자에 모음이 겹쳐지지는 않는다(입력기는 "곤"+ㅏ를 "고나"로 만든다).
    ["곤", "관"],
    // 받침이 없는 글자 뒤에 다른 첫소리는 오지 않는다.
    ["시", "사과"],
  ])("%s ↛ %s", (query, title) => {
    expect(matches(query, title)).toBe(false);
  });

  // 표의 항목을 하나씩 모두 확인한다.
  it.each([
    // 겹받침이 나뉜다: 겹받침 글자 다음에 모음을 치면 뒤 자음이 다음 글자로 간다.
    ["몫", "목사"],
    ["앉", "안자"],
    ["않", "안하"],
    ["닭", "달가"],
    ["삶", "살마"],
    ["넓", "널버"],
    ["곬", "골사"],
    ["핥", "할타"],
    ["읊", "을퍼"],
    ["앓", "알하"],
    ["값", "갑사"],
  ])("겹받침 나뉨: %s → %s", (query, title) => {
    expect(matches(query, title)).toBe(true);
  });

  it.each([
    ["고", "과"],
    ["고", "괘"],
    ["고", "괴"],
    ["구", "궈"],
    ["구", "궤"],
    ["구", "귀"],
    ["으", "의"],
  ])("겹모음: %s → %s", (query, title) => {
    expect(matches(query, title)).toBe(true);
  });

  it.each([
    ["목", "몫"],
    ["안", "앉"],
    ["안", "않"],
    ["달", "닭"],
    ["달", "닮"],
    ["달", "닯"],
    ["달", "닰"],
    ["달", "닱"],
    ["달", "닲"],
    ["달", "닳"],
    ["갑", "값"],
  ])("겹받침: %s → %s", (query, title) => {
    expect(matches(query, title)).toBe(true);
  });

  // DB 테스트(supabase/tests/suggest.test.sql)가 손으로 적어 넣는 패턴과 같아야 한다.
  it.each([
    ["가", "(?:가|[가-갛])"],
    ["괄호(시", "괄호\\((?:시|[시-싷])"],
    ["괄호.", "괄호\\."],
  ])("DB 테스트와 같은 패턴: %s → %s", (query, pattern) => {
    expect(titleMatchPattern(query)).toBe(pattern);
  });

  it("빈 검색어는 빈 패턴", () => {
    expect(titleMatchPattern("")).toBe("");
  });

  it("정규식 기호는 글자 그대로 찾는다", () => {
    expect(matches("a.b", "a.b 문서")).toBe(true);
    expect(matches("a.b", "axb 문서")).toBe(false);
    expect(matches("(괄호", "(괄호) 문서")).toBe(true);
    expect(matches("1+1=2?", "1+1=2? 문제")).toBe(true);
    expect(matches("1+1=2?", "11=2 문제")).toBe(false);
  });
});
