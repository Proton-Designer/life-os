import { describe, expect, it } from "vitest";
import { computeHourRecapCore, pickNextCardCore } from "../end-of-hour-core";
import type { ReflectionCard } from "../types";

function card(overrides: Partial<ReflectionCard>): ReflectionCard {
  return {
    id: "card-1",
    userId: "user-1",
    kind: "goal",
    content: "Ship the thing",
    active: true,
    lastShownAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeHourRecapCore", () => {
  it("sums real work minutes per domain, excluding distractions", () => {
    const recap = computeHourRecapCore([
      { domain: "work", minutes: 30, isDistraction: false },
      { domain: "work", minutes: 10, isDistraction: false },
      { domain: "school", minutes: 15, isDistraction: false },
      { domain: "work", minutes: 5, isDistraction: true },
    ]);
    expect(recap.totalMinutes).toBe(60);
    expect(recap.workMinutes).toBe(55);
    expect(recap.distractionCount).toBe(1);
    expect(recap.byDomain).toEqual({ work: 40, school: 15 });
  });

  it("an empty window (nothing logged in the last 60 minutes) is honest zeros, not an error", () => {
    const recap = computeHourRecapCore([]);
    expect(recap).toEqual({ totalMinutes: 0, workMinutes: 0, distractionCount: 0, byDomain: {} });
  });

  it("counts a distraction toward totalMinutes and distractionCount but never toward byDomain", () => {
    const recap = computeHourRecapCore([{ domain: "work", minutes: 20, isDistraction: true }]);
    expect(recap.totalMinutes).toBe(20);
    expect(recap.workMinutes).toBe(0);
    expect(recap.distractionCount).toBe(1);
    expect(recap.byDomain).toEqual({});
  });
});

describe("pickNextCardCore", () => {
  it("a never-shown card (lastShownAt null) counts as oldest -- picked over any real timestamp", () => {
    const shown = card({ id: "shown", lastShownAt: "2020-01-01T00:00:00.000Z" });
    const neverShown = card({ id: "never", lastShownAt: null });
    expect(pickNextCardCore([shown, neverShown])?.id).toBe("never");
    expect(pickNextCardCore([neverShown, shown])?.id).toBe("never");
  });

  it("among two shown cards, picks the one shown longest ago", () => {
    const older = card({ id: "older", lastShownAt: "2026-01-01T00:00:00.000Z" });
    const newer = card({ id: "newer", lastShownAt: "2026-06-01T00:00:00.000Z" });
    expect(pickNextCardCore([older, newer])?.id).toBe("older");
  });

  it("never picks an archived (active: false) card", () => {
    const archived = card({ id: "archived", active: false, lastShownAt: null });
    const active = card({ id: "active", active: true, lastShownAt: "2026-06-01T00:00:00.000Z" });
    expect(pickNextCardCore([archived, active])?.id).toBe("active");
  });

  it("returns null when there are no eligible (active) cards", () => {
    expect(pickNextCardCore([])).toBeNull();
    expect(pickNextCardCore([card({ active: false })])).toBeNull();
  });
});
