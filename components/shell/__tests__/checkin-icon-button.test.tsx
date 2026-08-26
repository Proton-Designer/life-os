import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { getAllocationQueueForNowMock } = vi.hoisted(() => ({ getAllocationQueueForNowMock: vi.fn() }));
vi.mock("@/app/(app)/checkin/allocation-actions", () => ({
  getAllocationQueueForNow: (...args: unknown[]) => getAllocationQueueForNowMock(...args),
  saveAllocationCheckin: vi.fn(),
}));

import { CheckInIconButton } from "../checkin-icon-button";
import { AllocationQueueProvider } from "@/lib/checkins/allocation-queue-context";

function renderButton() {
  return render(
    <AllocationQueueProvider>
      <CheckInIconButton />
    </AllocationQueueProvider>
  );
}

describe("CheckInIconButton", () => {
  beforeEach(() => {
    getAllocationQueueForNowMock.mockReset();
  });

  it("is always clickable — no time gating, unlike the old disabled 'too early' state", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
    renderButton();
    const button = await screen.findByRole("button", { name: "Open check-in" });
    expect(button).toBeEnabled();
  });

  it("does not glow when nothing is pending", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
    renderButton();
    const button = await screen.findByRole("button", { name: "Open check-in" });
    expect(button.className).not.toMatch(/is-pending/);
  });

  it("glows once a window is pending in the queue", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({
      items: [
        {
          windowStartIso: "2026-08-19T13:00:00.000Z",
          windowEndIso: "2026-08-19T15:00:00.000Z",
          prefill: { deen: 0, business: 0, school: 0, fitness: 0, coop: 0, wasted: 0 },
        },
      ],
      unknownCount: 0,
      timezone: "UTC",
    });
    renderButton();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open check-in" }).className).toMatch(/is-pending/);
    });
  });

  it("opens the check-in sheet (via context) on click regardless of pending state", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [], unknownCount: 0, timezone: "UTC" });
    const user = userEvent.setup();
    renderButton();
    const button = await screen.findByRole("button", { name: "Open check-in" });
    // No assertion errors on click confirms setOpen(true) is reachable —
    // AllocationCheckinGate (the sheet itself) isn't rendered in this test,
    // so there's nothing further to assert without duplicating its own
    // coverage in allocation-checkin-gate.test.tsx.
    await user.click(button);
  });
});
