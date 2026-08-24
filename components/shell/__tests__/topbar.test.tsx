import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Topbar itself no longer reads the route (title moved to PageHeader), but
// its drawer renders SidebarNav, which does.
vi.mock("next/navigation", () => ({
  usePathname: () => "/deen",
}));

const { signOutMock, getNotificationsForNowMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  getNotificationsForNowMock: vi.fn(),
}));
vi.mock("@/app/(app)/actions", () => ({
  signOut: signOutMock,
  getNotificationsForNow: (...args: unknown[]) => getNotificationsForNowMock(...args),
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
      <Topbar
        account={ACCOUNT}
        dateLabel="Fri, Aug 15"
        nowIso="2026-08-15T18:00:00.000-05:00"
        timezone="America/Chicago"
        {...props}
      />
    </AllocationQueueProvider>
  );
}

describe("Topbar", () => {
  beforeEach(() => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
    getNotificationsForNowMock.mockResolvedValue([]);
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
  });

  it("closes the drawer on Escape", async () => {
    const user = userEvent.setup();
    renderTopbar();
    await user.click(screen.getByRole("button", { name: /open menu/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the account trigger inside the drawer (replaced by a calendar link in the topbar itself)", async () => {
    const user = userEvent.setup();
    renderTopbar();
    expect(screen.queryByRole("button", { name: /account menu/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open menu/i }));
    expect(await screen.findByRole("button", { name: /account menu/i })).toBeInTheDocument();
  });

  it("shows a calendar link in place of the account icon at the top right", () => {
    renderTopbar();
    expect(screen.getByRole("link", { name: /open calendar/i })).toHaveAttribute("href", "/calendar");
  });

  it("shows the Distractions button in the topbar", () => {
    renderTopbar();
    expect(screen.getByRole("button", { name: /distractions/i })).toBeInTheDocument();
  });

  // Fake timers here (not just nowIso) because Topbar's mount effect
  // immediately re-ticks `now` to the real wall clock (staleTimes-cache
  // correction, see the component's own comment) — without pinning the
  // system clock too, that tick would overwrite the seeded time with
  // whatever real time the test actually runs at.
  it("hides the Review link before 9pm local", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T20:59:00.000-05:00"));
    try {
      renderTopbar({ nowIso: "2026-08-15T20:59:00.000-05:00", timezone: "America/Chicago" });
      expect(screen.queryByRole("link", { name: "Review" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the Review link once local time is past 9pm", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T21:00:00.000-05:00"));
    try {
      renderTopbar({ nowIso: "2026-08-15T21:00:00.000-05:00", timezone: "America/Chicago" });
      expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("href", "/review");
    } finally {
      vi.useRealTimers();
    }
  });

  it("prefetches its own cross-screen links (navigation-prefetch-fix, Part A)", () => {
    renderTopbar();
    expect(screen.getByRole("link", { name: /life os/i })).toHaveAttribute("data-prefetch", "true");
  });

  it("shows a notification count badge when items are pending, and routes to the right screen section", async () => {
    getNotificationsForNowMock.mockResolvedValue([
      { id: "prayer-fajr", domain: "deen", title: "Fajr", body: "Prayer window is open", href: "/deen#prayers", dueAt: null },
    ]);
    const user = userEvent.setup();
    renderTopbar();
    expect(await screen.findByRole("button", { name: "1 notification" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "1 notification" }));
    expect(await screen.findByRole("link", { name: /Fajr/ })).toHaveAttribute("href", "/deen#prayers");
  });

  it("shows no notification badge when nothing is pending", async () => {
    renderTopbar();
    expect(await screen.findByRole("button", { name: "No notifications" })).toBeInTheDocument();
  });

  // CheckinQueueBadge (a separate topbar indicator) is gone as of
  // 2026-08-20 (Opus Lead) — it was the ONLY entry point to the check-in
  // sheet and rendered null at count 0, so with the 30-minute answer
  // window it was on screen ~25% of the day. The queue is folded into the
  // bell instead, sorted first, so the bell is now the single persistent
  // "something's pending" surface.
  it("folds pending allocation check-ins into the bell, sorted first, and opens the sheet in place (no route change)", async () => {
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
    getNotificationsForNowMock.mockResolvedValue([
      { id: "prayer-fajr", domain: "deen", title: "Fajr", body: "Prayer window is open", href: "/deen#prayers", dueAt: null },
    ]);
    const user = userEvent.setup();
    renderTopbar();

    // Count is checkin (1) + domain notification (1) = 2, not counted separately.
    const bellButton = await screen.findByRole("button", { name: "2 notifications" });
    expect(screen.queryByRole("button", { name: /waiting/ })).not.toBeInTheDocument();

    await user.click(bellButton);
    const checkinItem = await screen.findByRole("button", { name: /Check-in/ });
    const fajrItem = screen.getByRole("link", { name: /Fajr/ });
    // Sorted first: the check-in button precedes the Fajr link in the DOM.
    expect(checkinItem.compareDocumentPosition(fajrItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Tapping it opens the sheet in place — no navigation, no /checkin route.
    await user.click(checkinItem);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); // AllocationCheckinGate isn't mounted in this tree
    expect(window.location.pathname).not.toBe("/checkin");
  });

  it("shows no notification badge when nothing is pending, checkins included", async () => {
    renderTopbar();
    expect(await screen.findByRole("button", { name: "No notifications" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /waiting/ })).not.toBeInTheDocument();
  });
});
