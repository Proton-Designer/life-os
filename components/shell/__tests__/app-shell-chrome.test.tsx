import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { AppShellChrome } from "../app-shell-chrome";

const ACCOUNT = { displayName: "Ayman", email: "ayman@example.com" };

describe("AppShellChrome", () => {
  it("renders the sidebar, topbar, mobile island, and page content", () => {
    render(
      <AppShellChrome account={ACCOUNT} dateLabel="Fri, Aug 15" hasActiveLockIn={false}>
        <div>Page content</div>
      </AppShellChrome>
    );

    expect(screen.getAllByRole("link", { name: "Life OS" })[0]).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText("Home")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-island-item-home")).toBeInTheDocument();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });
});
