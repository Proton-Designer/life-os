import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/deen",
}));

import { TopNav } from "../top-nav";

describe("TopNav", () => {
  it("renders an icon for every nav item", () => {
    render(<TopNav />);
    for (const label of ["Home", "Deen", "Business", "Fitness", "School", "Co-op"]) {
      const link = screen.getByRole("link", { name: new RegExp(label, "i") });
      expect(link.querySelector("svg")).toBeInTheDocument();
    }
  });

  it("marks the active route with aria-current and a domain-tinted pill", () => {
    render(<TopNav />);
    const active = screen.getByRole("link", { name: /deen/i });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active.style.color).toContain("--accent-deen");
  });

  it("does not tint inactive items", () => {
    render(<TopNav />);
    const inactive = screen.getByRole("link", { name: /business/i });
    expect(inactive).not.toHaveAttribute("aria-current");
    expect(inactive.style.color).toBe("");
  });

  it("tints the Settings link with the info accent when active", () => {
    render(<TopNav />);
    const settings = screen.getByRole("link", { name: /settings/i });
    expect(settings.style.color).toBe("");
  });
});
