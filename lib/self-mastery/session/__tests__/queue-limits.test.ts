import { describe, expect, it } from "vitest";
import { computeMedianElapsedMs, estimateSessionCapacity, allocateQueueLimits, SEED_MS_PER_CARD } from "../queue-limits";

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
