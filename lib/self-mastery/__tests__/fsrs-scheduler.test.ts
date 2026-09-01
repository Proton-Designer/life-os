import { describe, expect, it } from "vitest";
import { createEmptyCard, State } from "ts-fsrs";
import { getScheduler, computeNextState, DEFAULT_REQUEST_RETENTION } from "../fsrs-scheduler";

/**
 * ULM's oldest known defect, reproduced here before this repo's own port
 * inherited it structurally identically: `desired_retention` round-tripped
 * through Settings correctly and never reached the scheduler that actually
 * computes review intervals. Per the ULM lead's own field map
 * (ULM/docs/notes/desired-retention-map.md): "the only observation that
 * closes this is... grade the same card at 0.90 and at 0.95 and confirm
 * the persisted intervals actually differ. Reading the code proves nothing
 * here — the code always looked right." This test exercises the SAME
 * functions retrieval-session-overlay.tsx's handleGrade calls in
 * production (getScheduler + computeNextState), not a reimplementation —
 * a synthetic scheduler built fresh in the test would prove ts-fsrs
 * respects retention, which was never in question; it would NOT prove
 * this codebase's wiring passes the value through, which is the actual
 * defect.
 */
describe("getScheduler + computeNextState — desired_retention actually reaches the scheduler", () => {
  it("two identical cards, graded identically, at two different desired_retention values produce genuinely different due dates", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    // Same starting state for both -- the control check the field map's
    // own "could_also_be" calls for: if these weren't identical, a
    // divergence in the result wouldn't prove retention did anything.
    // state: Review is load-bearing, not decorative -- a card left at its
    // createEmptyCard default (State.New) is scheduled via ts-fsrs's fixed
    // learning-step intervals, which ignore request_retention entirely.
    // Without this override the test passes for the wrong reason (both
    // schedulers hitting the same fixed learning step) even with the
    // defect still present -- caught by literally running this red first
    // and getting a false "fixed" result until this override was added.
    const cardA = { ...createEmptyCard(now), state: State.Review, reps: 5, stability: 15, difficulty: 6 };
    const cardB = { ...createEmptyCard(now), state: State.Review, reps: 5, stability: 15, difficulty: 6 };
    expect(cardA).toEqual(cardB);

    const lowRetentionScheduler = getScheduler(0.9);
    const highRetentionScheduler = getScheduler(0.95);

    const { card: resultLow } = computeNextState(lowRetentionScheduler, cardA, 3, now);
    const { card: resultHigh } = computeNextState(highRetentionScheduler, cardB, 3, now);

    // A HIGHER desired retention means reviewing sooner (a shorter
    // interval) -- the scheduler must schedule the user back before their
    // recall probability drops as far. If this fails, retention isn't
    // reaching ts-fsrs at all -- exactly the defect being closed.
    expect(resultHigh.due.getTime()).not.toBe(resultLow.due.getTime());
    expect(resultHigh.due.getTime()).toBeLessThan(resultLow.due.getTime());
  });

  it("getScheduler caches per distinct retention value rather than rebuilding on every call, but never shares a cache entry across different values", () => {
    const a1 = getScheduler(0.92);
    const a2 = getScheduler(0.92);
    const b = getScheduler(0.93);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("defaults to 0.9 (the brief's stated default) when no retention is passed -- the pinned call sites (memory-strength.ts) rely on this", () => {
    expect(getScheduler()).toBe(getScheduler(DEFAULT_REQUEST_RETENTION));
  });
});
