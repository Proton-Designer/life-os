import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const getAllocationQueueForNowMock = vi.fn();
const saveAllocationCheckinMock = vi.fn(async (..._args: unknown[]) => {});
// NAV-02: the shell polls are fetches (lib/client/shell-fetch.ts), not Server Actions; route them to the same fakes.
vi.mock("@/lib/client/shell-fetch", () => ({
  shellFetch: async (path: string) => {
    if (path.startsWith("/api/shell/allocation-queue")) return getAllocationQueueForNowMock();
    if (path.startsWith("/api/shell/notifications")) return [];
    if (path.startsWith("/api/shell/distraction-count")) return 0;
    throw new Error(`unmocked shell fetch: ${path}`);
  },
}));

vi.mock("@/app/(app)/checkin/allocation-actions", () => ({
  saveAllocationCheckin: (...args: unknown[]) => saveAllocationCheckinMock(...args),
}));

import { LockInCheckin } from "../lock-in-checkin";
import { AllocationQueueProvider } from "@/lib/checkins/allocation-queue-context";

const WINDOW_A = {
  windowStartIso: "2026-09-10T13:00:00.000Z",
  windowEndIso: "2026-09-10T15:00:00.000Z",
  prefill: { deen: 15, business: 0, school: 0, fitness: 0, co_op: 0 },
};

function renderCheckin() {
  return render(
    <AllocationQueueProvider>
      <LockInCheckin />
    </AllocationQueueProvider>
  );
}

describe("LockInCheckin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when the queue is empty", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
    const { container } = renderCheckin();
    await waitFor(() => expect(getAllocationQueueForNowMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the allocation form for the current queue item once the queue has one", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "America/Chicago" });
    renderCheckin();
    expect(await screen.findByTestId("allocation-bar")).toBeInTheDocument();
    expect(screen.getByText("Check-in")).toBeInTheDocument();
  });

  it("saving calls saveAllocationCheckin with this window's start/end and the edited allocation, then clears the item", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "America/Chicago" });
    renderCheckin();
    await screen.findByTestId("allocation-bar");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(saveAllocationCheckinMock).toHaveBeenCalledTimes(1));
    expect(saveAllocationCheckinMock).toHaveBeenCalledWith(
      WINDOW_A.windowStartIso,
      WINDOW_A.windowEndIso,
      expect.objectContaining({ deen: 15 }) // the prefill, untouched
    );
  });

  it("clears itself once the queue empties after a save (same context AllocationCheckinGate reads)", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "America/Chicago" });
    const { container } = renderCheckin();
    await screen.findByTestId("allocation-bar");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("never shows the ad-hoc 'check in whenever' fallback — only a real pending queue item", async () => {
    // No items pending at all (an empty queue), which is exactly the state
    // AllocationCheckinGate would fall back to mostRecentUnanswered/adHocWindow
    // for. LockInCheckin must render nothing here, not manufacture one.
    getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
    const { container } = renderCheckin();
    await waitFor(() => expect(getAllocationQueueForNowMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
