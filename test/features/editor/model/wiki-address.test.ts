import { describe, expect, it } from "vitest";

import { wikiAddressTarget } from "~/features/editor/model/wiki-address";

describe("wikiAddressTarget", () => {
  it("운영·미리보기 위키의 문서 주소를 문서 이름과 문단으로 바꾼다", () => {
    expect(
      wikiAddressTarget(
        "https://wiki.kmla.online/w/%EA%B7%80%EA%B0%80#%EC%8B%A0%EC%B2%AD",
      ),
    ).toEqual({ title: "귀가", section: "신청" });
    expect(wikiAddressTarget("https://wiki-dev.kmla.online/w/귀가")).toEqual({
      title: "귀가",
      section: "",
    });
  });

  it("밑줄은 공백으로, 하위 문서의 `/`는 그대로 둔다", () => {
    expect(
      wikiAddressTarget(
        "https://wiki.kmla.online/w/귀가/정기_귀가?redirect=no",
      ),
    ).toEqual({ title: "귀가/정기 귀가", section: "" });
  });

  it("앞의 https://를 뺀 주소도 받는다", () => {
    expect(wikiAddressTarget("  wiki.kmla.online/w/귀가  ")).toEqual({
      title: "귀가",
      section: "",
    });
  });

  it("지금 열린 위키 주소도 받는다", () => {
    expect(
      wikiAddressTarget(
        "http://localhost:5183/w/귀가",
        "http://localhost:5183",
      ),
    ).toEqual({ title: "귀가", section: "" });
    expect(wikiAddressTarget("http://localhost:5183/w/귀가")).toBeNull();
  });

  it("위키 문서 보기 주소가 아니면 null이다", () => {
    expect(wikiAddressTarget("귀가")).toBeNull();
    expect(wikiAddressTarget("https://kmla.hs.kr/w/귀가")).toBeNull();
    expect(wikiAddressTarget("https://wiki.kmla.online/edit/귀가")).toBeNull();
    expect(wikiAddressTarget("https://wiki.kmla.online/w/")).toBeNull();
    expect(wikiAddressTarget("https://wiki.kmla.online/w/%E0")).toBeNull();
    expect(wikiAddressTarget("http://wiki.kmla.online/w/귀가")).toBeNull();
    expect(
      wikiAddressTarget("https://wiki.kmla.online:8080/w/귀가"),
    ).toBeNull();
  });
});
