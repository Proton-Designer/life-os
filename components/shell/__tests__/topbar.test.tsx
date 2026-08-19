import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Topbar itself no longer reads the route (title moved to PageHeader), but
// its drawer renders SidebarNav, which does.
vi.mock("next/navigation", () => ({
  usePathname: () => "/deen",
}));

const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }));
vi.mock("@/app/(app)/actions", () => ({
  signOut: signOutMock,
}));

const { getAllocationQueueForNowMock } = vi.hoisted(() => ({ getAllocationQueueForNowMock: vi.fn() }));
vi.mock("@/app/(app)/checkin/allocation-actions", () => ({
  getAllocationQueueForNow: (...args: unknown[]) => getAllocationQueueForNowMock(...args),
  saveAllocationCheckin: vi.fn(),
}));

// Real next/link never forwards `prefetch` to the DOM (destructured out,
// consumed internally), so intercept it before Link eats it. Mirrors real
// rendering for every other prop this file's other assertions rely on.
// Also covers SidebarNav/AccountBlock, both rendered inside Topbar's drawer.
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function MockLink(
      { href, prefetch, children, ...rest }: React.ComponentPropsWithoutRef<"a"> & { prefetch?: unknown },
      ref: React.Ref<HTMLAnchorElement>
    ) {
      return (
        <a ref={ref} href={href} data-prefetch={String(prefetch)} {...rest}>
          {children}
        </a>
      );
    }),
    useLinkStatus: () => ({ pending: false }),
  };
});

import { Topbar } from "../topbar";
import { AllocationQueueProvider } from "@/lib/checkins/allocation-queue-context";

const ACCOUNT = { displayName: "Ayman", email: "ayman@example.com" };

function renderTopbar(props: Partial<React.ComponentProps<typeof Topbar>> = {}) {
  return render(
    <AllocationQueueProvider>
      <Topbar account={ACCOUNT} dateLabel="Fri, Aug 15" hasActiveLockIn={false} {...props} />
    </AllocationQueueProvider>
  );
}

describe("Topbar", () => {
  beforeEach(() => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
  });

  it("does not render a page title — PageHeader owns it, to avoid rendering it twice", () => {
    renderTopbar();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("shows the Life OS wordmark (visible only below lg, where the sidebar's own logo is hidden)", () => {
    renderTopbar();
    expect(screen.getByRole("link", { name: /life os/i })).toHaveAttribute("href", "/");
  });

  it("shows today's date", () => {
    renderTopbar();
    expect(screen.getByText("Fri, Aug 15")).toBeInTheDocument();
  });

  it("has no search field — deliberately rejected per spec", () => {
    renderTopbar();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders a menu button that opens a drawer with the full nav", async () => {
    const user = userEvent.setup();
    renderTopbar();

    await user.click(screen.getByRole("button", { name: /open menu/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Insights" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Weekly Planning" })).toBeInTheDocument();
  });

  it("closes the drawer on Escape", async () => {
    const user = userEvent.setup();
    renderTopbar();
    await user.click(screen.getByRole("button", { name: /open menu/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the account trigger", () => {
    renderTopbar();
    expect(screen.getByRole("button", { name: /account menu/i })).toBeInTheDocument();
  });

  it("prefetches its own cross-screen links (navigation-prefetch-fix, Part A)", () => {
    renderTopbar();
    expect(screen.getByRole("link", { name: /life os/i })).toHaveAttribute("data-prefetch", "true");
    expect(
      screen.getByRole("link", { name: /no active lock-in session|lock-in session active/i })
    ).toHaveAttribute("data-prefetch", "true");
  });

  it("shows the check-in queue badge when items are pending", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({
      items: [
        {
          windowStartIso: "2026-08-19T13:00:00.000Z",
          windowEndIso: "2026-08-19T15:00:00.000Z",
          prefill: { deen: 0, business: 0, school: 0, fitness: 0, co_op: 0 },
        },
      ],
      unknownCount: 0,
      timezone: "America/Chicago",
    });
    renderTopbar();
    expect(await screen.findByRole("button", { name: "1 check-in waiting" })).toBeInTheDocument();
  });

  it("hides the check-in queue badge when nothing is pending", async () => {
    renderTopbar();
    await screen.findByRole("button", { name: /account menu/i });
    expect(screen.queryByRole("button", { name: /waiting/ })).not.toBeInTheDocument();
  });
});
