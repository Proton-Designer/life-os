import { describe, expect, it } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import { getScheduler, computeNextState } from "../../lib/self-mastery/fsrs-scheduler";
import { planCardBackfill, type ReviewForBackfill } from "../backfill-review-state-after";

const DB_STATE = ["new", "learning", "review", "relearning"] as const;

/** Same ground-truth-via-real-scheduler approach as
 * lib/self-mastery/__tests__/scheduler-cache.test.ts -- builds fixtures by
 * actually replaying ratings through the real scheduler, not by hand. */
function buildReviews(ratings: Array<1 | 2 | 3 | 4>, startAt: Date, daysBetween: number): { rows: ReviewForBackfill[]; finalState: (typeof DB_STATE)[number] } {
  const scheduler = getScheduler();
  let card = createEmptyCard(startAt);
  const rows: ReviewForBackfill[] = [];
  let when = startAt;
  for (const rating of ratings) {
    const stateBefore = DB_STATE[card.state]!;
    const stabilityBefore = card.state === 0 ? null : card.stability;
    const difficultyBefore = card.state === 0 ? null : card.difficulty;
    const { card: next } = computeNextState(scheduler, card, rating, when);
    rows.push({
      id: `review-${rows.length}`,
      card_id: "card-1",
      rating,
      reviewed_at: when.toISOString(),
      state_before: stateBefore,
      stability_before: stabilityBefore,
      difficulty_before: difficultyBefore,
      state_after: null, // the column this whole script exists to fill
    });
    card = next;
    when = new Date(when.getTime() + daysBetween * 86_400_000);
  }
  return { rows, finalState: DB_STATE[card.state]! };
}

describe("planCardBackfill", () => {
  it("all rows null: derives every row, matching the real scheduler's step-by-step result", () => {
    const { rows, finalState } = buildReviews([3, 3, 1], new Date("2026-08-01T00:00:00.000Z"), 3);
    const plan = planCardBackfill(rows);
    expect(plan).toHaveLength(3);
    expect(plan.every((s) => s.action === "derive")).toBe(true);
    const last = plan[plan.length - 1];
    expect(last!.action === "derive" && last!.stateAfter).toBe(finalState);
  });

  it("resume case: rows already backfilled by Tier 1 (or a prior run) are marked already-set, not re-derived, and the running counters still advance correctly through them", () => {
    const { rows, finalState } = buildReviews([3, 3, 4], new Date("2026-08-01T00:00:00.000Z"), 3);
    // Simulate Tier 1 having already filled the first row's state_after
    // with the (real) value it should have -- the second row's own
    // state_before already IS that value in this fixture, since
    // buildReviews used the real scheduler.
    rows[0]!.state_after = rows[1]!.state_before;
    const plan = planCardBackfill(rows);
    expect(plan[0]!.action).toBe("already-set");
    expect(plan[1]!.action).toBe("derive");
    expect(plan[2]!.action).toBe("derive");
    const last = plan[2]!;
    expect(last.action === "derive" && last.stateAfter).toBe(finalState);
  });

  it("all rows already set: a fully-backfilled card is a clean no-op re-run (idempotency)", () => {
    const { rows } = buildReviews([3, 3], new Date("2026-08-01T00:00:00.000Z"), 3);
    // Derive once for real to get correct values, then mark all as set --
    // simulating "this script already ran successfully."
    const firstPass = planCardBackfill(rows);
    for (let i = 0; i < rows.length; i++) {
      const step = firstPass[i]!;
      rows[i]!.state_after = step.action === "derive" ? step.stateAfter : rows[i]!.state_after;
    }
    const secondPass = planCardBackfill(rows);
    expect(secondPass.every((s) => s.action === "already-set")).toBe(true);
  });

  it("a null state_before produces an error step, and every LATER row in that card is marked skipped-after-earlier-error rather than derived against an unknown prior state", () => {
    const { rows } = buildReviews([3, 3, 1], new Date("2026-08-01T00:00:00.000Z"), 3);
    rows[1]!.state_before = null; // corrupt the middle row
    const plan = planCardBackfill(rows);
    expect(plan[0]!.action).toBe("derive"); // unaffected, comes before the corruption
    expect(plan[1]!.action).toBe("error");
    expect(plan[2]!.action).toBe("skipped-after-earlier-error");
  });

  it("row order in the input does not matter -- planCardBackfill sorts by reviewed_at itself", () => {
    const { rows } = buildReviews([3, 1, 4], new Date("2026-08-01T00:00:00.000Z"), 2);
    const shuffled = [rows[2]!, rows[0]!, rows[1]!];
    const planOrdered = planCardBackfill(rows);
    const planShuffled = planCardBackfill(shuffled);
    expect(planShuffled).toEqual(planOrdered);
  });

  it("empty input: a clean empty plan, not an error", () => {
    expect(planCardBackfill([])).toEqual([]);
  });
});
