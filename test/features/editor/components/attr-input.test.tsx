import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AttrInput } from "~/features/editor/components/node-views";

describe("AttrInput", () => {
  it("writes to the node only after Korean composition ends", () => {
    const onCommit = vi.fn<(value: string) => void>();
    render(<AttrInput aria-label="캡션" value="" onCommit={onCommit} />);
    const input = screen.getByRole("textbox", { name: "캡션" });

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "ㅎ" } });
    fireEvent.change(input, { target: { value: "한" } });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue("한");

    fireEvent.compositionEnd(input);
    expect(onCommit).toHaveBeenLastCalledWith("한");
  });

  it("writes plain typing at once and follows outside changes", () => {
    const onCommit = vi.fn<(value: string) => void>();
    const { rerender } = render(
      <AttrInput aria-label="캡션" value="" onCommit={onCommit} />,
    );
    const input = screen.getByRole("textbox", { name: "캡션" });
    fireEvent.change(input, { target: { value: "a" } });
    expect(onCommit).toHaveBeenLastCalledWith("a");

    rerender(
      <AttrInput aria-label="캡션" value="되돌림" onCommit={onCommit} />,
    );
    expect(input).toHaveValue("되돌림");
  });
});
