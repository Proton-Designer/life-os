import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { getNotificationsForNowMock, markNotificationReadForNowMock } = vi.hoisted(() => ({
  getNotificationsForNowMock: vi.fn(),
  markNotificationReadForNowMock: vi.fn(),
}));
vi.mock("@/app/(app)/actions", () => ({
  getNotificationsForNow: (...args: unknown[]) => getNotificationsForNowMock(...args),
  markNotificationReadForNow: (...args: unknown[]) => markNotificationReadForNowMock(...args),
}));

const { getAllocationQueueForNowMock } = vi.hoisted(() => ({ getAllocationQueueForNowMock: vi.fn() }));
vi.mock("@/app/(app)/checkin/allocation-actions", () => ({
  getAllocationQueueForNow: (...args: unknown[]) => getAllocationQueueForNowMock(...args),
  saveAllocationCheckin: vi.fn(),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function MockLink(
      { href, children, ...rest }: React.ComponentPropsWithoutRef<"a">,
      ref: React.Ref<HTMLAnchorElement>
    ) {
      return (
        <a ref={ref} href={href} {...rest}>
          {children}
        </a>
      );
    }),
  };
});

import { NotificationsBell } from "../notifications-bell";
import { AllocationQueueProvider } from "@/lib/checkins/allocation-queue-context";

function renderBell() {
  return render(
    <AllocationQueueProvider>
      <NotificationsBell />
    </AllocationQueueProvider>
  );
}

const FAJR = {
  id: "prayer-fajr",
  domain: "deen" as const,
  title: "Fajr",
  body: "Prayer window is open",
  href: "/deen#prayers",
  dueAt: null,
  read: false,
};
const KILL_LIST = {
  id: "kill-list",
  domain: "business" as const,
  title: "Kill list",
  body: "Today's kill list needs attention",
  href: "/business#kill-list",
  dueAt: null,
  read: false,
};

describe("NotificationsBell — read/unread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
    markNotificationReadForNowMock.mockResolvedValue(undefined);
  });

  it("counts an already-read item as read: styled darkened, excluded from the badge count", async () => {
    getNotificationsForNowMock.mockResolvedValue([{ ...FAJR, read: true }]);
    renderBell();

    expect(await screen.findByRole("button", { name: "No notifications" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "No notifications" }));
    const link = await screen.findByRole("link", { name: /Fajr/ });
    expect(link).toHaveAttribute("data-read", "true");
    expect(link.className).toMatch(/opacity-60/);
  });

  it("clicking an unread item marks it read immediately (optimistic) and decrements the count", async () => {
    getNotificationsForNowMock.mockResolvedValue([FAJR, KILL_LIST]);
    const user = userEvent.setup();
    renderBell();

    const bellButton = await screen.findByRole("button", { name: "2 notifications" });
    await user.click(bellButton);
    const fajrLink = await screen.findByRole("link", { name: /Fajr/ });
    expect(fajrLink).toHaveAttribute("data-read", "false");

    await user.click(fajrLink);

    // Reopen the popover (click closed it) — count dropped to 1 without waiting for a re-poll.
    await user.click(screen.getByRole("button", { name: "1 notification" }));
    expect(within(screen.getByTestId("notification-prayer-fajr")).getByText("Fajr")).toBeInTheDocument();
    expect(screen.getByTestId("notification-prayer-fajr")).toHaveAttribute("data-read", "true");
    expect(screen.getByTestId("notification-kill-list")).toHaveAttribute("data-read", "false");
  });

  it("persists the read mark server-side via markNotificationReadForNow", async () => {
    getNotificationsForNowMock.mockResolvedValue([FAJR]);
    const user = userEvent.setup();
    renderBell();

    await user.click(await screen.findByRole("button", { name: "1 notification" }));
    await user.click(await screen.findByRole("link", { name: /Fajr/ }));

    expect(markNotificationReadForNowMock).toHaveBeenCalledWith("prayer-fajr", expect.any(String));
  });

  it("clicking an already-read item again does not re-call markNotificationReadForNow", async () => {
    getNotificationsForNowMock.mockResolvedValue([{ ...FAJR, read: true }]);
    const user = userEvent.setup();
    renderBell();

    await user.click(await screen.findByRole("button", { name: "No notifications" }));
    await user.click(await screen.findByRole("link", { name: /Fajr/ }));

    expect(markNotificationReadForNowMock).not.toHaveBeenCalled();
  });

  it("a read-but-unresolved item stays visible in the list, never disappears", async () => {
    getNotificationsForNowMock.mockResolvedValue([{ ...FAJR, read: true }]);
    renderBell();

    await userEvent.setup().click(await screen.findByRole("button", { name: "No notifications" }));
    expect(await screen.findByRole("link", { name: /Fajr/ })).toBeInTheDocument();
    expect(screen.queryByText("Nothing waiting on you.")).not.toBeInTheDocument();
  });

  it("shows the empty state only when there is truly nothing, read or unread", async () => {
    getNotificationsForNowMock.mockResolvedValue([]);
    renderBell();

    await userEvent.setup().click(await screen.findByRole("button", { name: "No notifications" }));
    expect(await screen.findByText("Nothing waiting on you.")).toBeInTheDocument();
  });

  it("a pending check-in is never affected by domain-item read state and always counts", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({
      items: [
        {
          windowStartIso: "2026-08-19T13:00:00.000Z",
          windowEndIso: "2026-08-19T15:00:00.000Z",
          prefill: { deen: 0, business: 0, school: 0, fitness: 0, co_op: 0 },
        },
      ],
      unknownCount: 0,
      timezone: "UTC",
    });
    getNotificationsForNowMock.mockResolvedValue([{ ...FAJR, read: true }]);
    const user = userEvent.setup();
    renderBell();

    // 1 (checkin) + 0 (Fajr already read) = 1.
    const bellButton = await screen.findByRole("button", { name: "1 notification" });
    await user.click(bellButton);
    expect(screen.getByRole("button", { name: /Check-in/ })).toBeInTheDocument();
  });
});
