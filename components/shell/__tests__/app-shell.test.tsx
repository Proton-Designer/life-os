import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { AppShell } from "../app-shell";

describe("AppShell", () => {
  it("renders the nav and page content", () => {
    render(
      <AppShell>
        <div>Page content</div>
      </AppShell>
    );

    // Both TopNav (desktop) and MobileIsland render a "Primary" nav landmark
    // simultaneously in jsdom (real responsive CSS hiding isn't applied) —
    // asserting on TopNav's distinctive logo link instead of the ambiguous
    // shared landmark name.
    expect(screen.getByRole("link", { name: "Life OS" })).toBeInTheDocument();
    expect(screen.getByTestId("mobile-island-item-home")).toBeInTheDocument();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });
});
