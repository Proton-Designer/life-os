import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const getAllocationQueueForNowMock = vi.fn();
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
  saveAllocationCheckin: vi.fn(),
}));
// CheckinToast now reads useLockInOverlay() too (Phase 5: suppressed while
// the Lock-In overlay is expanded), so it needs a real provider ancestor —
// same as every other consumer of that hook. Not exercised by most of this
// file's tests (initialSession: null keeps it a no-op), but importing
// lock-in-overlay-context.tsx pulls in this module regardless.
vi.mock("@/app/(app)/business/actions", () => ({
  startWorkSession: vi.fn(),
  endWorkSession: vi.fn(),
  toggleSessionObjective: vi.fn(),
  getActiveSessionDetail: vi.fn(async () => null),
}));

import { CheckinToast } from "../checkin-toast";
import { AllocationQueueProvider } from "@/lib/checkins/allocation-queue-context";
import { LockInOverlayProvider, type ActiveWorkSession } from "@/components/business/lock-in-overlay-context";

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

function renderToast(lockInSession: ActiveWorkSession | null = null) {
  return render(
    <LockInOverlayProvider initialSession={lockInSession}>
      <AllocationQueueProvider>
        <CheckinToast />
      </AllocationQueueProvider>
    </LockInOverlayProvider>
  );
}

describe("CheckinToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("toasts exactly once for a queue that's already pending on first load — nothing in it can be stale under the 30-minute window", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
    renderToast();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Check-in available");
  });

  it("does not re-toast on a later poll that returns the same still-pending item", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
    renderToast();
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
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

  // Phase 5 (Ayman): "they should disappear after 5 minutes of being out",
  // replacing the original 8 seconds.
  describe("auto-dismiss duration", () => {
    it("stays up at 8 seconds — the OLD duration must not still apply", async () => {
      getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
      renderToast();
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByRole("status")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("auto-dismisses once 5 minutes have passed", async () => {
      getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
      renderToast();
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByRole("status")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000);
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  it("is anchored to the right edge, not centered, on every viewport width", async () => {
    getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
    renderToast();
    await act(async () => {
      await Promise.resolve();
    });
    const toastEl = screen.getByRole("status");
    expect(toastEl.className).toMatch(/\bright-3\b/);
    expect(toastEl.className).not.toMatch(/\binset-x-3\b/);
    expect(toastEl.className).toMatch(/slide-in-from-right/);
  });

  describe("suppressed while the Lock-In overlay is expanded", () => {
    it("does not render when a Lock-In session is active and the overlay is expanded", async () => {
      getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
      const session: ActiveWorkSession = {
        id: "s1",
        startedAtIso: new Date().toISOString(),
        kind: "deep_work",
        goalMinutes: null,
        objectives: [],
      };
      localStorage.setItem(`lockin-minimized:${session.id}`, "0"); // "0" = not minimized = expanded
      renderToast(session);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("stays hidden while a Lock-In session is active but minimized (a session is never interrupted by a check-in)", async () => {
      getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
      const session: ActiveWorkSession = {
        id: "s1",
        startedAtIso: new Date().toISOString(),
        kind: "deep_work",
        goalMinutes: null,
        objectives: [],
      };
      localStorage.setItem(`lockin-minimized:${session.id}`, "1"); // "1" = minimized
      renderToast(session);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("still renders with no Lock-In session active at all", async () => {
      getAllocationQueueForNowMock.mockResolvedValue({ items: [WINDOW_A], unknownCount: 0, timezone: "UTC" });
      renderToast(null);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });
});
