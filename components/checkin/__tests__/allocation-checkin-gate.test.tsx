import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const getAllocationQueueForNowMock = vi.fn();
const saveAllocationCheckinMock = vi.fn();
vi.mock("@/app/(app)/checkin/allocation-actions", () => ({
  getAllocationQueueForNow: (...args: unknown[]) => getAllocationQueueForNowMock(...args),
  saveAllocationCheckin: (...args: unknown[]) => saveAllocationCheckinMock(...args),
}));

import { AllocationCheckinGate } from "../allocation-checkin-gate";
import { AllocationQueueProvider, useAllocationQueue } from "@/lib/checkins/allocation-queue-context";

const WINDOW_A = {
  windowStartIso: "2026-08-19T13:00:00.000Z",
  windowEndIso: "2026-08-19T15:00:00.000Z",
  prefill: { deen: 15, business: 0, school: 0, fitness: 0, co_op: 0 },
};
const WINDOW_B = {
  windowStartIso: "2026-08-19T15:00:00.000Z",
  windowEndIso: "2026-08-19T17:00:00.000Z",
  prefill: { deen: 0, business: 0, school: 0, fitness: 0, co_op: 0 },
};

/** Stand-in for Engineer 2's real shell-chrome badge — just enough to drive `open` from the same shared context. */
function TestBadge() {
  const { queue, setOpen } = useAllocationQueue();
  if (queue.length === 0) return null;
  return (
    <button type="button" onClick={() => setOpen(true)}>
      {queue.length} check-in{queue.length === 1 ? "" : "s"} waiting
    </button>
  );
}

/** Stand-in for the real CheckInIconButton (batch 3, B3-1) — always visible, unlike TestBadge above. */
function TestAlwaysOpenButton() {
  const { setOpen } = useAllocationQueue();
  return (
    <button type="button" onClick={() => setOpen(true)}>
      Open check-in
    </button>
  );
}

function renderGate() {
  return render(
    <AllocationQueueProvider>
      <TestBadge />
      <AllocationCheckinGate />
    </AllocationQueueProvider>
  );
}

describe("AllocationCheckinGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows only the badge, not the sheet, when the queue is non-empty — opening is the user's action", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "America/Chicago" });
    renderGate();

    expect(await screen.findByRole("button", { name: /1 check-in waiting/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing (no badge, no sheet) when the queue is empty", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
    renderGate();
    await waitFor(() => expect(getAllocationQueueForNowMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /waiting/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the sheet on badge tap, showing the oldest pending window with a pre-filled domain marked", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "America/Chicago" });
    const user = userEvent.setup();
    renderGate();

    await user.click(await screen.findByRole("button", { name: /waiting/ }));

    expect(await screen.findByRole("dialog", { name: "Check-in" })).toBeInTheDocument();
    expect(screen.getByText("App filled this in")).toBeInTheDocument();
  });

  it("shows a queue position indicator when more than one window is pending", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A, WINDOW_B], unknownCount: 0, timezone: "UTC" });
    const user = userEvent.setup();
    renderGate();

    await user.click(await screen.findByRole("button", { name: /waiting/ }));
    expect(await screen.findByText("1 of 2")).toBeInTheDocument();
  });

  it("saves via the bound window's own start/end, then shows the next queued item with the correct position", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A, WINDOW_B], unknownCount: 0, timezone: "UTC" });
    saveAllocationCheckinMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderGate();

    await user.click(await screen.findByRole("button", { name: /waiting/ }));
    await screen.findByText("1 of 2");
    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() =>
      expect(saveAllocationCheckinMock).toHaveBeenCalledWith(
        WINDOW_A.windowStartIso,
        WINDOW_A.windowEndIso,
        WINDOW_A.prefill
      )
    );
    // One item left — correctly reads "2 of 2", not "1 of 2" again (regression: index used to be hardcoded to 1).
    await waitFor(() => expect(screen.getByText("2 of 2")).toBeInTheDocument());
  });

  // Regression: an earlier version auto-opened an inescapable fixed overlay
  // with no close control, no Escape handler, and no focus trap despite
  // claiming aria-modal="true" — caught by the Opus Lead's review, then
  // superseded again (Engineer 2 hit a still-blocking modal live with 6
  // queued items) by this badge+sheet split. When "Done" is the only way
  // out, tapping Done without editing becomes the only escape, manufacturing
  // exactly the rubber-stamped data this build spent an hour eliminating
  // from pre-fill.
  it("Escape closes the sheet without saving — the badge remains, queue untouched", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
    const user = userEvent.setup();
    renderGate();

    await user.click(await screen.findByRole("button", { name: /waiting/ }));
    await screen.findByRole("dialog", { name: "Check-in" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(saveAllocationCheckinMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /1 check-in waiting/ })).toBeInTheDocument();
  });

  it("exposes a close (X) control, per the shared Dialog primitive", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
    const user = userEvent.setup();
    renderGate();

    await user.click(await screen.findByRole("button", { name: /waiting/ }));
    expect(await screen.findByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  // Batch 3, B3-1 ("check in whenever"): the polled queue only ever holds
  // pending_queue items, which vanish once ALLOCATION_ANSWER_WINDOW_MINUTES
  // lapses. A manual, always-visible trigger (CheckInIconButton in
  // production, TestAlwaysOpenButton here) must still open a real,
  // answerable sheet by falling back to mostRecentUnanswered — not render
  // nothing, and not silently no-op the save.
  describe("manual 'check in whenever' fallback (queue empty, mostRecentUnanswered present)", () => {
    function renderWithAlwaysOpenTrigger() {
      return render(
        <AllocationQueueProvider>
          <TestAlwaysOpenButton />
          <AllocationCheckinGate />
        </AllocationQueueProvider>
      );
    }

    it("opens the sheet bound to mostRecentUnanswered when the polled queue is empty", async () => {
      getAllocationQueueForNowMock.mockResolvedValue({
        items: [],
        unknownCount: 0,
        timezone: "America/Chicago",
        mostRecentUnanswered: WINDOW_A,
      });
      const user = userEvent.setup();
      renderWithAlwaysOpenTrigger();

      await user.click(await screen.findByRole("button", { name: "Open check-in" }));
      expect(await screen.findByRole("dialog", { name: "Check-in" })).toBeInTheDocument();
    });

    it("saves against mostRecentUnanswered's own window bounds, exactly like an ordinary save", async () => {
      getAllocationQueueForNowMock.mockResolvedValue({
        items: [],
        unknownCount: 0,
        timezone: "America/Chicago",
        mostRecentUnanswered: WINDOW_A,
      });
      saveAllocationCheckinMock.mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderWithAlwaysOpenTrigger();

      await user.click(await screen.findByRole("button", { name: "Open check-in" }));
      await screen.findByRole("dialog", { name: "Check-in" });
      await user.click(screen.getByRole("button", { name: "Done" }));

      await waitFor(() =>
        expect(saveAllocationCheckinMock).toHaveBeenCalledWith(
          WINDOW_A.windowStartIso,
          WINDOW_A.windowEndIso,
          WINDOW_A.prefill
        )
      );
    });

    it("renders no dialog when there's truly nothing to fall back to (queue empty, mostRecentUnanswered null)", async () => {
      getAllocationQueueForNowMock.mockResolvedValue({
        items: [],
        unknownCount: 0,
        timezone: "UTC",
        mostRecentUnanswered: null,
      });
      const user = userEvent.setup();
      renderWithAlwaysOpenTrigger();

      await user.click(await screen.findByRole("button", { name: "Open check-in" }));
      // setOpen(true) fires, but `current` is null, so the gate renders nothing.
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
