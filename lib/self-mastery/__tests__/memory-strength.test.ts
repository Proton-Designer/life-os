import { describe, it, expect } from "vitest";
import { cardRetrievability, averageRetrievability, type CardStateForStrength } from "../memory-strength";

const NOW = new Date("2026-09-01T12:00:00.000Z");

function reviewed(overrides: Partial<CardStateForStrength> = {}): CardStateForStrength {
  return {
    state: "review",
    stability: 10,
    difficulty: 5,
    dueAt: null,
    reps: 3,
    lapses: 0,
    lastReviewAt: NOW.toISOString(),
    learningSteps: 0,
    ...overrides,
  };
}

describe("cardRetrievability", () => {
  it("returns 0 for a card with no card_states row at all", () => {
    expect(cardRetrievability(null, NOW)).toBe(0);
  });

  it("returns 0 for a card still in the 'new' state", () => {
    expect(
      cardRetrievability({ state: "new", stability: null, difficulty: null, dueAt: null, reps: 0, lapses: 0, lastReviewAt: null, learningSteps: 0 }, NOW)
    ).toBe(0);
  });

  it("returns 0 (not NaN/throw) when stability or lastReviewAt is missing despite a non-new state — a data anomaly the schema shouldn't produce, but must not poison an average", () => {
    expect(cardRetrievability(reviewed({ stability: null }), NOW)).toBe(0);
    expect(cardRetrievability(reviewed({ lastReviewAt: null }), NOW)).toBe(0);
  });

  it("returns ~1.0 for a card reviewed right now (elapsed = 0)", () => {
    const r = cardRetrievability(reviewed({ lastReviewAt: NOW.toISOString() }), NOW);
    expect(r).toBeCloseTo(1.0, 5);
  });

  it("decays as elapsed time grows relative to stability", () => {
    const oneDayAgo = new Date(NOW.getTime() - 86_400_000).toISOString();
    const tenDaysAgo = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();
    const rSoon = cardRetrievability(reviewed({ stability: 10, lastReviewAt: oneDayAgo }), NOW);
    const rLate = cardRetrievability(reviewed({ stability: 10, lastReviewAt: tenDaysAgo }), NOW);
    expect(rSoon).toBeGreaterThan(rLate);
    expect(rLate).toBeGreaterThan(0);
    expect(rLate).toBeLessThan(1);
  });

  it("never goes negative for a review timestamp in the future (clock skew)", () => {
    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    const r = cardRetrievability(reviewed({ stability: 10, lastReviewAt: future }), NOW);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });
});

describe("averageRetrievability", () => {
  it("returns 0 for an empty card set", () => {
    expect(averageRetrievability([], NOW)).toBe(0);
  });

  // The exact case the ULM lead's own smoke test verifies for
  // book_memory_strength: one near-perfect card + one never-touched card
  // must average to ~0.5, not ~1.0 (which would happen if the untouched
  // card were excluded from the denominator instead of counted as zero).
  // Holds regardless of which FSRS curve computes the per-card value —
  // this is testing the denominator rule, not the curve (per the ULM
  // lead's own note on why this case alone didn't catch the FSRS-5/6 gap).
  it("counts an untouched card as zero in the denominator, not excluded", () => {
    const nearPerfect = reviewed({ stability: 10, lastReviewAt: NOW.toISOString() });
    const avg = averageRetrievability([nearPerfect, null], NOW);
    expect(avg).toBeCloseTo(0.5, 2);
  });

  it("matches a plain arithmetic mean of the per-card values", () => {
    const a = reviewed({ stability: 5, lastReviewAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString() });
    const b = reviewed({ stability: 20, lastReviewAt: new Date(NOW.getTime() - 1 * 86_400_000).toISOString() });
    const expected = (cardRetrievability(a, NOW) + cardRetrievability(b, NOW) + 0) / 3;
    expect(averageRetrievability([a, b, null], NOW)).toBeCloseTo(expected, 10);
  });
});
