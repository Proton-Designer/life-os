import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/deen",
}));

import { MobileIsland } from "../mobile-island";

describe("MobileIsland", () => {
  it("renders exactly 5 top-level nav targets", () => {
    render(<MobileIsland />);
    expect(screen.getAllByTestId(/^mobile-island-item-/)).toHaveLength(5);
  });

  it("reveals Fitness and Co-op links when tapping More", async () => {
    const user = userEvent.setup();
    render(<MobileIsland />);

    expect(screen.queryByRole("link", { name: /fitness/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /more/i }));

    expect(screen.getByRole("link", { name: /fitness/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /co-op/i })).toBeInTheDocument();
  });

  it("marks the active route with aria-current", () => {
    render(<MobileIsland />);
    expect(screen.getByTestId("mobile-island-item-deen")).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByTestId("mobile-island-item-home")).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("renders a Lucide icon for every top-level item, no emoji", () => {
    render(<MobileIsland />);
    for (const key of ["home", "deen", "business", "school"]) {
      expect(screen.getByTestId(`mobile-island-item-${key}`).querySelector("svg")).toBeInTheDocument();
    }
  });

  it("tints the active item with its domain accent", () => {
    render(<MobileIsland />);
    expect(screen.getByTestId("mobile-island-item-deen").style.color).toContain("--accent-deen");
    expect(screen.getByTestId("mobile-island-item-home").style.color).toBe("");
  });
});
