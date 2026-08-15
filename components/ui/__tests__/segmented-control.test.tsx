import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "../segmented-control";

describe("SegmentedControl", () => {
  it("renders a link per option when hrefs are given, and marks the active one", () => {
    render(
      <SegmentedControl
        options={[
          { label: "Day", href: "/insights?range=day", active: false },
          { label: "Week", href: "/insights?range=week", active: true },
        ]}
      />
    );
    const week = screen.getByRole("link", { name: "Week" });
    const day = screen.getByRole("link", { name: "Day" });
    expect(week).toHaveAttribute("aria-current", "true");
    expect(day).not.toHaveAttribute("aria-current");
  });

  it("renders a button per option and calls onClick when hrefs aren't given", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SegmentedControl
        options={[
          { label: "Week", value: "week", active: true },
          { label: "Month", value: "month", active: false },
        ]}
        onSelect={onSelect}
      />
    );
    await user.click(screen.getByRole("button", { name: "Month" }));
    expect(onSelect).toHaveBeenCalledWith("month");
  });
});
