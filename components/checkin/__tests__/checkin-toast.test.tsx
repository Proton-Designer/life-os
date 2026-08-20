import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const getAllocationQueueForNowMock = vi.fn();
vi.mock("@/app/(app)/checkin/allocation-actions", () => ({
  getAllocationQueueForNow: (...args: unknown[]) => getAllocationQueueForNowMock(...args),
  saveAllocationCheckin: vi.fn(),
}));

import { CheckinToast } from "../checkin-toast";
import { AllocationQueueProvider } from "@/lib/checkins/allocation-queue-context";

const WINDOW_A = {
  windowStartIso: "2026-08-19T13:00:00.000Z",
  windowEndIso: "2026-08-19T15:00:00.000Z",
  prefill: { deen: 0, business: 0, school: 0, fitness: 0, co_op: 0 },
};
const WINDOW_B = {
  windowStartIso: "2026-08-19T15:00:00.000Z",
  windowEndIso: "2026-08-19T17:00:00.000Z",
  prefill: { deen: 0, business: 0, school: 0, fitness: 0, co_op: 0 },
};

function renderToast() {
  return render(
    <AllocationQueueProvider>
      <CheckinToast />
    </AllocationQueueProvider>
  );
}

describe("CheckinToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not toast for a queue that's already pending on first load", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
    renderToast();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("fires a real desktop Notification when permission is already granted", async () => {
    const NotificationCtor = vi.fn();
    vi.stubGlobal("Notification", Object.assign(NotificationCtor, { permission: "granted" }));
    getAllocationQueueForNowMock.mockResolvedValueOnce({ items: [], unknownCount: 0, timezone: "UTC" });
    getAllocationQueueForNowMock.mockResolvedValueOnce({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
    renderToast();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(NotificationCtor).toHaveBeenCalledWith("Check-in available", expect.objectContaining({ tag: "allocation-checkin" }));
    vi.unstubAllGlobals();
  });

  it("does not attempt a desktop Notification when permission was never granted", async () => {
    const NotificationCtor = vi.fn();
    vi.stubGlobal("Notification", Object.assign(NotificationCtor, { permission: "default" }));
    getAllocationQueueForNowMock.mockResolvedValueOnce({ items: [], unknownCount: 0, timezone: "UTC" });
    getAllocationQueueForNowMock.mockResolvedValueOnce({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
    renderToast();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(NotificationCtor).not.toHaveBeenCalled();
    // The in-app half still fires regardless — the two channels are independent.
    expect(screen.getByRole("status")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("toasts when a new window fires on a later poll", async () => {
    getAllocationQueueForNowMock.mockResolvedValueOnce({ items: [], unknownCount: 0, timezone: "UTC" });
    getAllocationQueueForNowMock.mockResolvedValueOnce({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
    renderToast();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Check-in available");
  });

  it("counts multiple newly-fired windows in the same poll", async () => {
    getAllocationQueueForNowMock.mockResolvedValueOnce({ items: [], unknownCount: 0, timezone: "UTC" });
    getAllocationQueueForNowMock.mockResolvedValueOnce({
      items: [WINDOW_A, WINDOW_B],
      unknownCount: 0,
      timezone: "UTC",
    });
    renderToast();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("2 check-ins available");
  });

  it("dismiss button clears the toast", async () => {
    getAllocationQueueForNowMock.mockResolvedValueOnce({ items: [], unknownCount: 0, timezone: "UTC" });
    getAllocationQueueForNowMock.mockResolvedValueOnce({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
    renderToast();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
