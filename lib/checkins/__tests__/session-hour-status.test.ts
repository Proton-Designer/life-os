import { describe, it, expect } from "vitest";
import {
  resolveSessionHours,
  pendingSessionHour,
  resolvedHourRanges,
  deriveExtraMissedWasteMinutes,
} from "../session-hour-status";

const startedAt = new Date("2026-08-19T12:00:00.000Z");

describe("resolveSessionHours", () => {
  it("returns nothing yet if no hour has fired", () => {
    const now = new Date("2026-08-19T12:30:00.000Z");
    expect(resolveSessionHours({ startedAt, endedAt: null }, 60, now, [])).toEqual([]);
  });

  it("a stored 'business' hour resolves to confirmed_business", () => {
    const now = new Date("2026-08-19T13:05:00.000Z");
    const stored = [{ hourStartIso: "2026-08-19T13:00:00.000Z", domain: "business" as const }];
    expect(resolveSessionHours({ startedAt, endedAt: null }, 60, now, stored)).toEqual([
      { hourStartIso: "2026-08-19T13:00:00.000Z", state: "confirmed_business" },
    ]);
  });

  it("a stored 'wasted' hour resolves to confirmed_wasted", () => {
    const now = new Date("2026-08-19T13:05:00.000Z");
    const stored = [{ hourStartIso: "2026-08-19T13:00:00.000Z", domain: "wasted" as const }];
    expect(resolveSessionHours({ startedAt, endedAt: null }, 60, now, stored)).toEqual([
      { hourStartIso: "2026-08-19T13:00:00.000Z", state: "confirmed_wasted" },
    ]);
  });

  it("an unanswered hour superseded by a newer fired slot derives missed_wasted, no row implied", () => {
    // Two hours have fired (13:00, 14:00), neither answered — 13:00 is
    // superseded (missed), 14:00 is the current due slot (pending, not in resolved()).
    const now = new Date("2026-08-19T14:05:00.000Z");
    expect(resolveSessionHours({ startedAt, endedAt: null }, 60, now, [])).toEqual([
      { hourStartIso: "2026-08-19T13:00:00.000Z", state: "missed_wasted" },
    ]);
  });

  it("the current due slot is pending, not included in resolved() at all", () => {
    const now = new Date("2026-08-19T13:05:00.000Z");
    expect(resolveSessionHours({ startedAt, endedAt: null }, 60, now, [])).toEqual([]);
    expect(pendingSessionHour({ startedAt, endedAt: null }, 60, now, [])).toBe("2026-08-19T13:00:00.000Z");
  });

  it("a closed session's dangling final due slot resolves to missed_wasted, not pending forever", () => {
    const endedAt = new Date("2026-08-19T13:10:00.000Z");
    const resolved = resolveSessionHours({ startedAt, endedAt }, 60, endedAt, []);
    expect(resolved).toEqual([{ hourStartIso: "2026-08-19T13:00:00.000Z", state: "missed_wasted" }]);
  });

  it("pendingSessionHour is always null for a closed session", () => {
    const endedAt = new Date("2026-08-19T13:10:00.000Z");
    expect(pendingSessionHour({ startedAt, endedAt }, 60, endedAt, [])).toBeNull();
  });

  it("an edited (stored) hour wins over what would otherwise derive as missed", () => {
    const now = new Date("2026-08-19T14:05:00.000Z");
    const stored = [{ hourStartIso: "2026-08-19T13:00:00.000Z", domain: "business" as const }];
    expect(resolveSessionHours({ startedAt, endedAt: null }, 60, now, stored)).toEqual([
      { hourStartIso: "2026-08-19T13:00:00.000Z", state: "confirmed_business" },
    ]);
  });

  it("returns hours sorted oldest first", () => {
    const now = new Date("2026-08-19T15:05:00.000Z");
    const stored = [{ hourStartIso: "2026-08-19T14:00:00.000Z", domain: "business" as const }];
    const resolved = resolveSessionHours({ startedAt, endedAt: null }, 60, now, stored);
    expect(resolved.map((r) => r.hourStartIso)).toEqual([
      "2026-08-19T13:00:00.000Z",
      "2026-08-19T14:00:00.000Z",
    ]);
  });
});

describe("resolvedHourRanges", () => {
  it("maps each resolved hour to its 60-minute TimeRange", () => {
    const resolved = [
      { hourStartIso: "2026-08-19T13:00:00.000Z", state: "confirmed_business" as const },
      { hourStartIso: "2026-08-19T14:00:00.000Z", state: "missed_wasted" as const },
    ];
    expect(resolvedHourRanges(resolved, 60)).toEqual([
      { start: new Date("2026-08-19T13:00:00.000Z"), end: new Date("2026-08-19T14:00:00.000Z") },
      { start: new Date("2026-08-19T14:00:00.000Z"), end: new Date("2026-08-19T15:00:00.000Z") },
    ]);
  });
});

describe("deriveExtraMissedWasteMinutes", () => {
  const rangeStart = new Date("2026-08-19T00:00:00.000Z");
  const rangeEnd = new Date("2026-08-20T00:00:00.000Z");

  it("adds 60 minutes for a missed hour with no stored row covering it", () => {
    const now = new Date("2026-08-19T14:05:00.000Z");
    const sessions = [{ startedAt, endedAt: null, storedHours: [] }];
    // 13:00 fired and got superseded by 14:00's due slot -> missed_wasted.
    expect(deriveExtraMissedWasteMinutes(sessions, [], rangeStart, rangeEnd, now)).toBe(60);
  });

  it("does NOT double-count a missed hour already covered by a wider stored row (the surrounding 2h window was later confirmed)", () => {
    const now = new Date("2026-08-19T14:05:00.000Z");
    const sessions = [{ startedAt, endedAt: null, storedHours: [] }];
    const storedRowSpans = [{ start: new Date("2026-08-19T12:00:00.000Z"), end: new Date("2026-08-19T14:00:00.000Z") }];
    expect(deriveExtraMissedWasteMinutes(sessions, storedRowSpans, rangeStart, rangeEnd, now)).toBe(0);
  });

  it("does not count a missed hour whose start falls outside the query range", () => {
    const now = new Date("2026-08-19T14:05:00.000Z");
    const sessions = [{ startedAt, endedAt: null, storedHours: [] }];
    const narrowRangeStart = new Date("2026-08-19T13:30:00.000Z"); // excludes 13:00
    expect(deriveExtraMissedWasteMinutes(sessions, [], narrowRangeStart, rangeEnd, now)).toBe(0);
  });

  it("sums across multiple sessions and multiple missed hours", () => {
    const now = new Date("2026-08-19T16:05:00.000Z");
    const secondStart = new Date("2026-08-19T18:00:00.000Z");
    const sessions = [
      { startedAt, endedAt: null, storedHours: [] }, // 13:00, 14:00, 15:00 all missed (16:00 is due)
      { startedAt: secondStart, endedAt: new Date("2026-08-19T20:10:00.000Z"), storedHours: [] }, // 19:00 missed, 20:00's dangling final due slot also resolves missed since the session closed
    ];
    expect(deriveExtraMissedWasteMinutes(sessions, [], rangeStart, rangeEnd, now)).toBe(5 * 60);
  });

  it("never counts the current pending due slot as missed", () => {
    const now = new Date("2026-08-19T13:05:00.000Z");
    const sessions = [{ startedAt, endedAt: null, storedHours: [] }];
    expect(deriveExtraMissedWasteMinutes(sessions, [], rangeStart, rangeEnd, now)).toBe(0);
  });
});
