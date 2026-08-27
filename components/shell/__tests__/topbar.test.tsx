import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Topbar itself no longer reads the route (title moved to PageHeader) and,
// since batch 3 item 2 removed its hamburger drawer, no longer renders
// SidebarNav either — kept only because CalendarDialogTrigger's subtree
// still expects next/navigation to be mockable.
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

// ReviewDialogTrigger (rendered by Topbar when reviewOpen) imports this
// directly — same "use client" imports "use server" pattern as
// DistractionCaptureDialog, mocked here for the same no-real-Supabase
// reason as the two actions modules above.
const { getReviewDataMock } = vi.hoisted(() => ({ getReviewDataMock: vi.fn() }));
vi.mock("@/app/(app)/review/actions", () => ({
  getReviewData: (...args: unknown[]) => getReviewDataMock(...args),
}));

// Real next/link never forwards `prefetch` to the DOM (destructured out,
// consumed internally), so intercept it before Link eats it. Mirrors real
// rendering for every other prop this file's other assertions rely on.
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
        getWeekCalendar={async () => ({ items: [], undatedDeadlines: [], deen: null, business: null })}
        onSaveDeen={async () => {}}
        onSaveBusiness={async () => {}}
        {...props}
      />
    </AllocationQueueProvider>
  );
}

describe("Topbar", () => {
  beforeEach(() => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
    getNotificationsForNowMock.mockResolvedValue([]);
    getReviewDataMock.mockResolvedValue({ dateLabel: "Saturday 15 Aug", groups: [] });
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

  // Batch 3, item 2: the hamburger drawer is gone — mobile navigation now
  // lives entirely in MobileIsland at the bottom, so there is no menu
  // trigger, no drawer dialog, and no account trigger here at all (sign-out
  // moved to Settings' Security panel, see settings-form.test.tsx).
  it("renders no menu button and no drawer — mobile nav lives in MobileIsland now", () => {
    renderTopbar();
    expect(screen.queryByRole("button", { name: /open menu/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /life os/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /account menu/i })).not.toBeInTheDocument();
  });

  it("shows a calendar button (opening a popup, not a navigation) in place of the account icon at the top right", () => {
    renderTopbar();
    expect(screen.getByRole("button", { name: /open calendar/i })).toBeInTheDocument();
  });

  it("prefetches calendar data shortly after mount (idle callback) and paints it instantly on open, still revalidating behind it", async () => {
    // 2026-08-26 (Opus Lead, C1 perf fix): CalendarDialogTrigger no longer
    // waits for a click to fetch — an idle-time prefetch after mount warms
    // its module-scope cache so an open with no preceding hover (touch,
    // keyboard) isn't a cold fetch either. Every open still revalidates
    // behind whatever's cached (stale-while-revalidate, load-bearing for
    // correctness — schedule/goal data can change from other screens
    // between opens), so a click after the prefetch triggers one more call,
    // not zero.
    const getWeekCalendar = vi.fn(async () => ({ items: [], undatedDeadlines: [], deen: null, business: null }));
    const user = userEvent.setup();
    renderTopbar({ getWeekCalendar });

    await waitFor(() => expect(getWeekCalendar).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // Painted from the prefetch — no spinner despite the revalidation below.
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    await waitFor(() => expect(getWeekCalendar).toHaveBeenCalledTimes(2));
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
  it("hides the Review button (popup trigger) before 9pm local", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T20:59:00.000-05:00"));
    try {
      renderTopbar({ nowIso: "2026-08-15T20:59:00.000-05:00", timezone: "America/Chicago" });
      expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the Review button once local time is past 9pm, opening a popup rather than navigating", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T21:00:00.000-05:00"));
    try {
      renderTopbar({ nowIso: "2026-08-15T21:00:00.000-05:00", timezone: "America/Chicago" });
      const reviewButton = screen.getByRole("button", { name: "Review" });
      expect(reviewButton).not.toHaveAttribute("href");

      vi.useRealTimers(); // userEvent needs real timers
      const user = userEvent.setup();
      await user.click(reviewButton);
      expect(await screen.findByRole("dialog", { name: /Review/ })).toBeInTheDocument();
      expect(getReviewDataMock).toHaveBeenCalledTimes(1);
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
