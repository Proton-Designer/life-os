import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Simulates a check-in data fetch that never resolves — proves the static
// shell (nav, page content) doesn't wait on it, which is the actual bug
// being fixed here (components/shell/app-shell.tsx previously awaited this
// data before returning any JSX at all, including TopNav/MobileIsland).
vi.mock("@/components/checkin/checkin-scheduler-loader", () => ({
  CheckinSchedulerLoader: () => {
    throw new Promise(() => {});
  },
}));

import { AppShell } from "../app-shell";

describe("AppShell", () => {
  it("renders the nav and page content immediately, without waiting on the check-in data fetch", () => {
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
