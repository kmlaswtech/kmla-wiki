import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ColorPicker } from "~/features/editor/components/style-controls";
import { MIXED } from "~/features/editor/model/cell-attrs";
import { TooltipProvider } from "~/shared/ui/tooltip";

function pressed(value: string | null | typeof MIXED) {
  render(
    <TooltipProvider>
      <ColorPicker kind="background" value={value} onChange={() => {}} />
    </TooltipProvider>,
  );
  return screen
    .queryAllByRole("button", { pressed: true })
    .map((button) => button.getAttribute("aria-label") ?? button.textContent);
}

describe("ColorPicker", () => {
  it("presses the clear button when there is no color", () => {
    expect(pressed(null)).toEqual(["배경 없음"]);
  });

  it("presses nothing when the selected cells have mixed colors", () => {
    expect(pressed(MIXED)).toEqual([]);
  });
});
