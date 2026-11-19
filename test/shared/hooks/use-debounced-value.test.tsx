import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "~/shared/hooks/use-debounced-value";

describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the first value right away", () => {
    const { result } = renderHook(() => useDebouncedValue("가", 150));
    expect(result.current).toBe("가");
  });

  it("follows the value only after it stays still for the delay", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 150),
      { initialProps: { value: "가" } },
    );

    rerender({ value: "가나" });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: "가나다" });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // 입력이 이어지는 동안에는 처음 값에 머문다.
    expect(result.current).toBe("가");

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe("가나다");
  });
});
