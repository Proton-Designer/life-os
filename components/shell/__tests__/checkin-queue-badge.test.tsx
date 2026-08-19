import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const getAllocationQueueForNowMock = vi.fn();
vi.mock("@/app/(app)/checkin/allocation-actions", () => ({
  getAllocationQueueForNow: (...args: unknown[]) => getAllocationQueueForNowMock(...args),
  saveAllocationCheckin: vi.fn(),
}));

import { CheckinQueueBadge } from "../checkin-queue-badge";
import { AllocationQueueProvider, useAllocationQueue } from "@/lib/checkins/allocation-queue-context";

const WINDOW = {
  windowStartIso: "2026-08-19T13:00:00.000Z",
  windowEndIso: "2026-08-19T15:00:00.000Z",
  prefill: { deen: 15, business: 0, school: 0, fitness: 0, co_op: 0 },
};

/** Exposes the shared `open` state so a test can assert the badge actually opened the sheet. */
function OpenProbe() {
  const { open } = useAllocationQueue();
  return <span data-testid="open-probe">{String(open)}</span>;
}

function renderBadge() {
  return render(
    <AllocationQueueProvider>
      <CheckinQueueBadge />
      <OpenProbe />
    </AllocationQueueProvider>
  );
}

describe("CheckinQueueBadge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when the queue is empty", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
    renderBadge();
    await screen.findByTestId("open-probe");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the count when one check-in is queued, singular", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW], unknownCount: 0, timezone: "America/Chicago" });
    renderBadge();
    expect(await screen.findByRole("button", { name: "1 check-in waiting" })).toBeInTheDocument();
  });

  it("shows the count when several are queued, plural", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({
      items: [WINDOW, WINDOW, WINDOW],
      unknownCount: 0,
      timezone: "America/Chicago",
    });
    renderBadge();
    expect(await screen.findByRole("button", { name: "3 check-ins waiting" })).toBeInTheDocument();
  });

  it("opens the shared sheet state when tapped, rather than owning its own dialog", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW], unknownCount: 0, timezone: "America/Chicago" });
    const user = userEvent.setup();
    renderBadge();
    expect(screen.getByTestId("open-probe")).toHaveTextContent("false");
    await user.click(await screen.findByRole("button", { name: "1 check-in waiting" }));
    expect(screen.getByTestId("open-probe")).toHaveTextContent("true");
  });

  it("meets the 44px minimum tap target", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW], unknownCount: 0, timezone: "America/Chicago" });
    renderBadge();
    const button = await screen.findByRole("button", { name: "1 check-in waiting" });
    expect(button.className).toMatch(/size-11|min-h-11/);
  });

  it("never uses a destructive/red treatment — this is information, not an alarm", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW], unknownCount: 0, timezone: "America/Chicago" });
    renderBadge();
    const button = await screen.findByRole("button", { name: "1 check-in waiting" });
    expect(button.innerHTML).not.toMatch(/destructive/i);
  });
});
