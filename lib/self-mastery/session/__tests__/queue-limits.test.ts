import { describe, expect, it } from "vitest";
import { computeMedianElapsedMs, estimateSessionCapacity, allocateQueueLimits, previewSession, SEED_MS_PER_CARD } from "../queue-limits";

describe("computeMedianElapsedMs", () => {
  it("seeds at 20s with no history", () => {
    expect(computeMedianElapsedMs([])).toBe(SEED_MS_PER_CARD);
  });

  it("takes the true median for an odd-length history", () => {
    expect(computeMedianElapsedMs([10_000, 30_000, 20_000])).toBe(20_000);
  });

  it("averages the two middle values for an even-length history", () => {
    expect(computeMedianElapsedMs([10_000, 20_000, 30_000, 40_000])).toBe(25_000);
  });

  it("falls back to the seed if the computed median is somehow non-positive", () => {
    expect(computeMedianElapsedMs([0, 0])).toBe(SEED_MS_PER_CARD);
  });
});

describe("estimateSessionCapacity", () => {
  it("computes cards-per-target-minutes at the given per-card cost", () => {
    // 8 minutes * 60_000ms = 480_000ms / 20_000ms per card = 24 cards
    expect(estimateSessionCapacity(8, 20_000)).toBe(24);
  });

  it("is always at least 1 — a session that can't fit even one card at the user's own settings is a settings problem, not an empty queue", () => {
    expect(estimateSessionCapacity(1, 120_000)).toBe(1);
  });
});

describe("allocateQueueLimits", () => {
  it("gives due cards priority, capped at what's actually due", () => {
    const limits = allocateQueueLimits(10, 3, 5);
    expect(limits).toEqual({ limitDue: 3, limitNew: 5 });
  });

  it("never asks for more due cards than exist — excess capacity goes to new, not wasted", () => {
    const limits = allocateQueueLimits(10, 20, 5);
    expect(limits).toEqual({ limitDue: 10, limitNew: 0 });
  });

  it("caps new cards at dailyNewLimit even when capacity allows more", () => {
    const limits = allocateQueueLimits(50, 0, 5);
    expect(limits).toEqual({ limitDue: 0, limitNew: 5 });
  });

  it("never allocates a negative limitNew when due alone exceeds capacity", () => {
    const limits = allocateQueueLimits(5, 10, 5);
    expect(limits).toEqual({ limitDue: 5, limitNew: 0 });
  });
});

describe("previewSession (what Home's card promises = what the session will take)", () => {
  // Ayman's account after one book: 222 new cards, none due, daily_new_limit 5, 8-minute target, seed pace 20s/card.
  it("takes at most dailyNewLimit new cards however many are waiting, and says how many are left", () => {
    const p = previewSession({ dueCount: 0, newCount: 222, targetMinutes: 8, dailyNewLimit: 5, medianMs: SEED_MS_PER_CARD });
    expect(p).toMatchObject({ sessionDue: 0, sessionNew: 5, dueWaiting: 0, newWaiting: 217 });
  });

  it("minutes come from the same pace math as the session: the cards it takes x the median pace, rounded up", () => {
    const p = previewSession({ dueCount: 0, newCount: 222, targetMinutes: 8, dailyNewLimit: 5, medianMs: SEED_MS_PER_CARD });
    expect(p.minutes).toBe(2); // 5 x 20s = 100s -> 2 min, not the 8-minute target
    const slow = previewSession({ dueCount: 0, newCount: 222, targetMinutes: 8, dailyNewLimit: 5, medianMs: 60_000 });
    expect(slow.minutes).toBe(5);
  });

  it("due cards come first and use the capacity; new gets what is left, capped by the limit", () => {
    const p = previewSession({ dueCount: 12, newCount: 40, targetMinutes: 8, dailyNewLimit: 5, medianMs: SEED_MS_PER_CARD });
    expect(p).toMatchObject({ sessionDue: 12, sessionNew: 5, newWaiting: 35 });
    expect(p.minutes).toBe(6); // 17 x 20s = 340s
  });

  it("a due backlog bigger than the session leaves the rest waiting and takes no new cards", () => {
    const cap = estimateSessionCapacity(8, SEED_MS_PER_CARD); // 24
    const p = previewSession({ dueCount: 100, newCount: 10, targetMinutes: 8, dailyNewLimit: 5, medianMs: SEED_MS_PER_CARD });
    expect(p).toMatchObject({ sessionDue: cap, sessionNew: 0, dueWaiting: 100 - cap, newWaiting: 10 });
    expect(p.minutes).toBe(8);
  });

  it("never promises more new cards than exist, and a limit of 0 takes none", () => {
    expect(previewSession({ dueCount: 0, newCount: 3, targetMinutes: 8, dailyNewLimit: 5, medianMs: SEED_MS_PER_CARD })).toMatchObject({ sessionNew: 3, newWaiting: 0 });
    expect(previewSession({ dueCount: 0, newCount: 30, targetMinutes: 8, dailyNewLimit: 0, medianMs: SEED_MS_PER_CARD })).toMatchObject({ sessionNew: 0, newWaiting: 30, minutes: 0 });
  });

  it("nothing at all is zero minutes", () => {
    expect(previewSession({ dueCount: 0, newCount: 0, targetMinutes: 8, dailyNewLimit: 5, medianMs: SEED_MS_PER_CARD })).toMatchObject({ sessionDue: 0, sessionNew: 0, minutes: 0 });
  });
});
