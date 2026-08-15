import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { AppSidebar } from "../app-sidebar";

describe("AppSidebar", () => {
  it("renders the logo linking home", () => {
    render(<AppSidebar account={{ displayName: "Ayman", email: "ayman@example.com" }} />);
    expect(screen.getAllByRole("link", { name: "Life OS" })[0]).toHaveAttribute("href", "/");
  });

  it("renders both the icon-rail and expanded nav content (CSS toggles which shows)", () => {
    render(<AppSidebar account={{ displayName: "Ayman", email: "ayman@example.com" }} />);
    // Both variants render simultaneously in jsdom (no real responsive CSS) —
    // same convention as the pre-existing TopNav/MobileIsland coexistence.
    expect(screen.getAllByRole("link", { name: "Home" }).length).toBeGreaterThanOrEqual(2);
  });

  it("renders the account block in both variants", () => {
    render(<AppSidebar account={{ displayName: "Ayman", email: "ayman@example.com" }} />);
    expect(screen.getAllByRole("button", { name: /account menu/i }).length).toBeGreaterThanOrEqual(2);
  });
});
