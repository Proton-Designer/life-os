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

describe("AllocationCheckinGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when the queue is empty", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
    const { container } = render(<AllocationCheckinGate />);
    await waitFor(() => expect(getAllocationQueueForNowMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the oldest pending window as a dialog with a pre-filled domain marked", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "America/Chicago" });
    render(<AllocationCheckinGate />);

    expect(await screen.findByRole("dialog", { name: "Check-in" })).toBeInTheDocument();
    expect(screen.getByText("App filled this in")).toBeInTheDocument();
  });

  it("shows a queue position indicator when more than one window is pending", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A, WINDOW_B], unknownCount: 0, timezone: "UTC" });
    render(<AllocationCheckinGate />);

    expect(await screen.findByText("1 of 2")).toBeInTheDocument();
  });

  it("saves via the bound window's own start/end, then advances to the next queued item", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A, WINDOW_B], unknownCount: 0, timezone: "UTC" });
    saveAllocationCheckinMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AllocationCheckinGate />);

    await screen.findByText("1 of 2");
    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() =>
      expect(saveAllocationCheckinMock).toHaveBeenCalledWith(
        WINDOW_A.windowStartIso,
        WINDOW_A.windowEndIso,
        WINDOW_A.prefill
      )
    );
    // Only one item left — no position indicator, and window B's content is showing.
    await waitFor(() => expect(screen.queryByText(/of 2/)).not.toBeInTheDocument());
  });
});
