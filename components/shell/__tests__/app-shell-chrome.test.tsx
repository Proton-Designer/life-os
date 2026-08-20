import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// AppShellChrome renders AllocationCheckinGate, which calls this Server
// Action on mount to fetch the pending check-in queue — mocked so this
// stays the "fully client-testable through RTL" half of the shell (see the
// file's own header comment) rather than reaching for real Supabase env.
vi.mock("@/app/(app)/checkin/allocation-actions", () => ({
  getAllocationQueueForNow: vi.fn(async () => ({ items: [], unknownCount: 0, timezone: "UTC" })),
  saveAllocationCheckin: vi.fn(async () => {}),
}));

// NotificationsBell (topbar.tsx) calls this on mount — same
// fully-client-testable rationale as the allocation-actions mock above.
vi.mock("@/app/(app)/actions", () => ({
  signOut: vi.fn(),
  getNotificationsForNow: vi.fn(async () => []),
}));

import { AppShellChrome } from "../app-shell-chrome";

const ACCOUNT = { displayName: "Ayman", email: "ayman@example.com" };

describe("AppShellChrome", () => {
  it("renders the sidebar, topbar, mobile island, and page content", () => {
    render(
      <AppShellChrome account={ACCOUNT} dateLabel="Fri, Aug 15">
        <div>Page content</div>
      </AppShellChrome>
    );

    expect(screen.getAllByRole("link", { name: "Life OS" })[0]).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText("Fri, Aug 15")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-island-item-home")).toBeInTheDocument();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });
});
