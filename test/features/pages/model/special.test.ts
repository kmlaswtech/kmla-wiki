import { describe, expect, it } from "vitest";

import {
  sizeListNav,
  SPECIAL_PAGE_SIZE,
  titleListNav,
} from "~/features/pages/model/special";

describe("sizeListNav", () => {
  it("has only a next page at the start", () => {
    expect(sizeListNav("short", "main", 0, true)).toEqual({
      first: null,
      prev: null,
      next: `/special?tab=short&ns=main&offset=${SPECIAL_PAGE_SIZE}`,
    });
  });

  it("steps back by one page and drops a zero offset", () => {
    expect(sizeListNav("long", "main", SPECIAL_PAGE_SIZE, false)).toEqual({
      first: "/special?tab=long&ns=main",
      prev: "/special?tab=long&ns=main",
      next: null,
    });
    expect(sizeListNav("long", "main", SPECIAL_PAGE_SIZE * 2, false).prev).toBe(
      `/special?tab=long&ns=main&offset=${SPECIAL_PAGE_SIZE}`,
    );
  });
});

describe("titleListNav", () => {
  it("goes on after the last title and never back one page", () => {
    expect(titleListNav("all", "main", undefined, "나", true)).toEqual({
      first: null,
      prev: null,
      next: "/special?tab=all&ns=main&after=%EB%82%98",
    });
    expect(titleListNav("orphan", "main", "가", "다", false)).toEqual({
      first: "/special?tab=orphan",
      prev: null,
      next: null,
    });
  });
});
