import { describe, expect, it } from "vitest";
import { currentPrayer } from "../current-prayer";
import type { PriorityItem } from "../types";

function prayer(name: string, startIso: string | null, endIso: string | null, over: Partial<PriorityItem> = {}): PriorityItem {
  return { id: `prayer-${name}`, domain: "deen", title: name, dueAt: startIso ? new Date(startIso) : null, windowEndAt: endIso ? new Date(endIso) : null, date: "2026-10-07", urgencyBucket: "right_now", completed: false, actionType: "toggle_prayer", actionRefId: name, cost: null, ...over };
}
const FAJR = prayer("fajr", "2026-10-07T10:30:00Z", "2026-10-07T12:00:00Z");
const DHUHR = prayer("dhuhr", "2026-10-07T17:00:00Z", "2026-10-07T20:00:00Z");
const ASR = prayer("asr", "2026-10-07T20:00:00Z", "2026-10-07T23:00:00Z");

describe("currentPrayer", () => {
  it("inside a window: that prayer", () => {
    expect(currentPrayer([FAJR, DHUHR, ASR], new Date("2026-10-07T18:00:00Z"))?.actionRefId).toBe("dhuhr");
  });
  it("start inclusive, end exclusive", () => {
    expect(currentPrayer([DHUHR], new Date("2026-10-07T17:00:00Z"))?.actionRefId).toBe("dhuhr");
    expect(currentPrayer([DHUHR], new Date("2026-10-07T20:00:00Z"))).toBeNull();
  });
  it("between windows: null (a window not yet open is not current)", () => {
    expect(currentPrayer([FAJR, DHUHR], new Date("2026-10-07T14:00:00Z"))).toBeNull();
  });
  it("a prayed prayer is not in the pending list, so it is null; one marked completed is skipped too", () => {
    expect(currentPrayer([], new Date("2026-10-07T18:00:00Z"))).toBeNull();
    expect(currentPrayer([{ ...DHUHR, completed: true }], new Date("2026-10-07T18:00:00Z"))).toBeNull();
  });
  it("never two: overlapping windows return the one that opened last", () => {
    const overlapA = prayer("dhuhr", "2026-10-07T17:00:00Z", "2026-10-07T21:00:00Z");
    const overlapB = prayer("asr", "2026-10-07T20:00:00Z", "2026-10-07T23:00:00Z");
    expect(currentPrayer([overlapA, overlapB], new Date("2026-10-07T20:30:00Z"))?.actionRefId).toBe("asr");
    expect(currentPrayer([overlapB, overlapA], new Date("2026-10-07T20:30:00Z"))?.actionRefId).toBe("asr");
  });
  it("ignores non-prayers and a prayer with no window", () => {
    expect(currentPrayer([prayer("isha", null, null), { ...DHUHR, actionType: "toggle_task" }], new Date("2026-10-07T18:00:00Z"))).toBeNull();
  });
});
