import { describe, expect, it } from "vitest";
import {
  ALLOCATION_WINDOW_MINUTES,
  computeAllocationWindows,
  resolveFireTime,
  resolveAllocationSlots,
  pendingQueue,
  unknownCount,
  activeCadence,
  type AllocationWindow,
  type TimeRange,
} from "../schedule";

const TZ = "America/Chicago"; // UTC-5 (CDT) on these dates

describe("computeAllocationWindows", () => {
  it("tiles wake-to-sleep into fixed 2-hour windows", () => {
    const windows = computeAllocationWindows("2026-08-10", { wakeTime: "08:00", sleepTime: "22:00" }, TZ);
    // 08-10, 10-12, 12-2, 2-4, 4-6, 6-8, 8-10 = 7 windows over 14 hours.
    expect(windows).toHaveLength(7);
    expect(windows[0].start.toISOString()).toBe(new Date("2026-08-10T13:00:00Z").toISOString());
    expect(windows[0].end.toISOString()).toBe(new Date("2026-08-10T15:00:00Z").toISOString());
    expect(windows[6].end.toISOString()).toBe(new Date("2026-08-11T03:00:00Z").toISOString());
  });

  it("each window is exactly ALLOCATION_WINDOW_MINUTES long except a clamped trailing partial", () => {
    const windows = computeAllocationWindows("2026-08-10", { wakeTime: "08:00", sleepTime: "21:30" }, TZ);
    for (const w of windows.slice(0, -1)) {
      expect((w.end.getTime() - w.start.getTime()) / 60_000).toBe(ALLOCATION_WINDOW_MINUTES);
    }
    const last = windows[windows.length - 1];
    expect((last.end.getTime() - last.start.getTime()) / 60_000).toBe(90); // 20:00-21:30, clamped
  });

  it("produces no windows when wake >= sleep", () => {
    expect(computeAllocationWindows("2026-08-10", { wakeTime: "22:00", sleepTime: "08:00" }, TZ)).toEqual([]);
  });
});

describe("resolveFireTime", () => {
  const window: AllocationWindow = {
    start: new Date("2026-08-10T13:00:00Z"),
    end: new Date("2026-08-10T15:00:00Z"),
  };

  it("fires at the window's own end when nothing suppresses it", () => {
    expect(resolveFireTime(window, [])?.toISOString()).toBe(window.end.toISOString());
  });

  it("pushes the fire time past a single overlapping suppression range", () => {
    const prayer: TimeRange = { start: new Date("2026-08-10T14:50:00Z"), end: new Date("2026-08-10T15:20:00Z") };
    expect(resolveFireTime(window, [prayer])?.toISOString()).toBe(new Date("2026-08-10T15:20:00Z").toISOString());
  });

  it("chains through multiple back-to-back suppression ranges", () => {
    const prayer: TimeRange = { start: new Date("2026-08-10T14:50:00Z"), end: new Date("2026-08-10T15:10:00Z") };
    const commute: TimeRange = { start: new Date("2026-08-10T15:05:00Z"), end: new Date("2026-08-10T15:30:00Z") };
    expect(resolveFireTime(window, [prayer, commute])?.toISOString()).toBe(
      new Date("2026-08-10T15:30:00Z").toISOString()
    );
  });

  it("returns null when still inside an open-ended (active) suppression range", () => {
    const activeSession: TimeRange = { start: new Date("2026-08-10T14:00:00Z"), end: null };
    expect(resolveFireTime(window, [activeSession])).toBeNull();
  });

  it("ignores a suppression range that doesn't overlap the fire instant", () => {
    const unrelated: TimeRange = { start: new Date("2026-08-10T09:00:00Z"), end: new Date("2026-08-10T09:30:00Z") };
    expect(resolveFireTime(window, [unrelated])?.toISOString()).toBe(window.end.toISOString());
  });
});

describe("resolveAllocationSlots", () => {
  const bounds = { wakeTime: "08:00", sleepTime: "22:00" };

  it("marks a window in the future as upcoming", () => {
    const now = new Date("2026-08-10T13:30:00Z"); // 08:30 CDT, before the first window closes
    const slots = resolveAllocationSlots({
      dateStr: "2026-08-10",
      bounds,
      timezone: TZ,
      suppressionRanges: [],
      now,
      answeredWindowStarts: [],
    });
    expect(slots[0].outcome).toBe("upcoming");
  });

  it("marks a fired, unanswered, same-day window as pending_queue", () => {
    const now = new Date("2026-08-10T15:30:00Z"); // 10:30 CDT — the 08-10 window has closed
    const slots = resolveAllocationSlots({
      dateStr: "2026-08-10",
      bounds,
      timezone: TZ,
      suppressionRanges: [],
      now,
      answeredWindowStarts: [],
    });
    expect(slots[0].outcome).toBe("pending_queue");
    expect(slots[1].outcome).toBe("upcoming");
  });

  it("builds a multi-item queue when several windows fired unanswered — the normal case, not an edge case", () => {
    const now = new Date("2026-08-10T22:00:00Z"); // 17:00 CDT — 08-10, 10-12, 12-2, 2-4 have all closed
    const slots = resolveAllocationSlots({
      dateStr: "2026-08-10",
      bounds,
      timezone: TZ,
      suppressionRanges: [],
      now,
      answeredWindowStarts: [],
    });
    const queue = pendingQueue(slots);
    expect(queue).toHaveLength(4);
    // Oldest first.
    expect(queue[0].window.start.toISOString()).toBe(new Date("2026-08-10T13:00:00Z").toISOString());
    expect(queue[3].window.start.toISOString()).toBe(new Date("2026-08-10T19:00:00Z").toISOString());
  });

  it("does not re-queue an already-answered window", () => {
    const now = new Date("2026-08-10T15:30:00Z");
    const slots = resolveAllocationSlots({
      dateStr: "2026-08-10",
      bounds,
      timezone: TZ,
      suppressionRanges: [],
      now,
      answeredWindowStarts: [new Date("2026-08-10T13:00:00Z")],
    });
    expect(slots[0].outcome).toBe("answered");
    expect(pendingQueue(slots)).toHaveLength(0);
  });

  it("expires every unanswered window once the day it belongs to is over", () => {
    const now = new Date("2026-08-12T00:00:00Z"); // two days later
    const slots = resolveAllocationSlots({
      dateStr: "2026-08-10",
      bounds,
      timezone: TZ,
      suppressionRanges: [],
      now,
      answeredWindowStarts: [],
    });
    expect(pendingQueue(slots)).toHaveLength(0);
    expect(unknownCount(slots)).toBe(7);
  });

  it("does not expire a window still suppressed by an open-ended range even after its own day is over", () => {
    // A Lock-In session that started yesterday and, per the data available,
    // has still never ended — resolveFireTime can't resolve a fire time for
    // it, so it stays unresolved rather than being falsely marked unknown.
    const now = new Date("2026-08-12T00:00:00Z");
    const activeSession: TimeRange = { start: new Date("2026-08-10T13:30:00Z"), end: null };
    const slots = resolveAllocationSlots({
      dateStr: "2026-08-10",
      bounds,
      timezone: TZ,
      suppressionRanges: [activeSession],
      now,
      answeredWindowStarts: [],
    });
    // The window overlapping the still-open session is unresolved (day-over
    // rule only fires once we actually have a fire time to compare) — NOT
    // expired_unknown, since we don't yet know if/when it fires.
    expect(slots[0].fireTime).toBeNull();
    expect(slots[0].outcome).toBe("upcoming");
    expect(unknownCount(slots)).toBe(0);
  });

  it("keeps a window unanswered-but-still-queued at day's own last instant, not yet expired", () => {
    const now = new Date("2026-08-10T15:30:00Z"); // still 8/10 locally
    const slots = resolveAllocationSlots({
      dateStr: "2026-08-10",
      bounds,
      timezone: TZ,
      suppressionRanges: [],
      now,
      answeredWindowStarts: [],
    });
    expect(unknownCount(slots)).toBe(0);
  });
});

describe("activeCadence", () => {
  it("is allocation_window with no active Lock-In session", () => {
    expect(activeCadence(null)).toBe("allocation_window");
  });

  it("switches to session_hourly during an active Lock-In session", () => {
    expect(activeCadence({ startedAt: new Date("2026-08-10T13:00:00Z") })).toBe("session_hourly");
  });
});
