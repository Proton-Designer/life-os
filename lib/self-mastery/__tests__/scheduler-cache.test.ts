// ONE TEST IN THIS FILE IS DELIBERATELY RED as of 2026-09-02: "R17
// completeness: a card_states row REBUILT from the log carries enough
// learning_steps information for a real SECOND round-trip to graduate
// correctly." It fails today because `toFsrsCard` (fsrs-scheduler.ts, owned
// by LifeOS Eng 1) still hardcodes `learning_steps: 0` -- same root cause
// as the red test in fsrs-scheduler.test.ts's "toFsrsCard round-trip"
// describe block, found independently via this module's rebuild path
// rather than the live submit_review path. Do not mark it passing, skip
// it, or loosen its assertion to make the suite green -- it is a real,
// intentional signal that this file's rebuild is only as complete as
// fsrs-scheduler.ts's own fix; both should flip green together once that
// fix lands (migration 111 supplies the columns it needs).
import { describe, expect, it } from "vitest";
import { createEmptyCard, dateDiffInDays, State } from "ts-fsrs";
import { getScheduler, computeNextState, toFsrsCard } from "../fsrs-scheduler";
import { rebuildOneItem, type ReviewRow } from "../scheduler-cache";

// Ground-truth harness: replays a real rating sequence through the ACTUAL
// scheduler (the same computeNextState the app calls at grade time), and
// records each step exactly as submit_review + the state_after backfill
// would persist it to `reviews` -- state_before captured BEFORE the step,
// state_after/stability_after/difficulty_after/scheduled_days captured from
// the step's own result. This is the ground truth rebuildOneItem is checked
// against, not a hand-computed expectation -- if rebuildOneItem disagrees
// with what the real scheduler actually produced, that's the bug this test
// exists to catch. rebuildOneItem itself makes zero scheduler calls; this
// harness does, deliberately, to generate fixtures that are known-correct
// against ts-fsrs's real behaviour.
function replayToReviewRows(ratings: Array<1 | 2 | 3 | 4>, startAt: Date, daysBetween: number): ReviewRow[] {
  const scheduler = getScheduler();
  const DB_STATE = ["new", "learning", "review", "relearning"] as const;
  let card = createEmptyCard(startAt);
  const rows: ReviewRow[] = [];
  let when = startAt;
  for (const rating of ratings) {
    const stateBefore = card.state;
    const { card: next, scheduledDays } = computeNextState(scheduler, card, rating, when);
    rows.push({
      rating,
      reviewed_at: when.toISOString(),
      state_before: DB_STATE[stateBefore]!,
      state_after: DB_STATE[next.state]!,
      stability_after: next.stability,
      difficulty_after: next.difficulty,
      scheduled_days: scheduledDays,
      learning_steps_after: next.learning_steps ?? 0,
    });
    card = next;
    when = new Date(when.getTime() + daysBetween * 86_400_000);
  }
  return Object.assign(rows, { _finalState: DB_STATE[card.state], _finalStability: card.stability, _finalDifficulty: card.difficulty });
}

describe("rebuildOneItem", () => {
  it("single review: reps=1, state matches the real scheduler's first-grade result", () => {
    const rows = replayToReviewRows([3], new Date("2026-08-01T00:00:00.000Z"), 0);
    const result = rebuildOneItem(rows);
    expect(result.reps).toBe(1);
    expect(result.lapses).toBe(0); // rating=3 (Good), not an Again -- never a lapse regardless of state_before
    expect(result.stability).toBe(rows[0]!.stability_after);
    expect(result.difficulty).toBe(rows[0]!.difficulty_after);
    expect(result.state).toBe((rows as any)._finalState);
  });

  it("multi-review, no lapses: reps/state/stability/difficulty all match the real replay", () => {
    const rows = replayToReviewRows([3, 3, 4], new Date("2026-08-01T00:00:00.000Z"), 3);
    const result = rebuildOneItem(rows);
    expect(result.reps).toBe(3);
    expect(result.lapses).toBe(0);
    const last = rows[rows.length - 1]!;
    expect(result.stability).toBe(last.stability_after);
    expect(result.difficulty).toBe(last.difficulty_after);
    expect(result.due_at).toBe(new Date(new Date(last.reviewed_at).getTime() + last.scheduled_days! * 86_400_000).toISOString());
    expect(result.state).toBe((rows as any)._finalState);
    expect(result.last_rating).toBe(4);
  });

  it("lapses formula: an Again on a NEW card (never yet 'review') is NOT a lapse -- matches submit_review's corrected formula", () => {
    // First review is Again (rating=1) on a card whose state_before is 'new'.
    const rows = replayToReviewRows([1, 3, 3], new Date("2026-08-01T00:00:00.000Z"), 3);
    expect(rows[0]!.state_before).toBe("new");
    expect(rows[0]!.rating).toBe(1);
    const result = rebuildOneItem(rows);
    expect(result.lapses).toBe(0); // the Again happened on state_before='new', not 'review' -- must not count
  });

  it("lapses formula: an Again on a card already in 'review' state IS a lapse", () => {
    // Graduate the card into 'review' first (three Goods should be enough
    // with default parameters), then hit it with an Again.
    const graduation = replayToReviewRows([3, 3, 3], new Date("2026-08-01T00:00:00.000Z"), 3);
    const graduatedState = (graduation as any)._finalState;
    // Only meaningful if the card actually reached 'review' by then --
    // assert the premise rather than silently no-op if ts-fsrs parameters
    // changed and graduation now takes longer.
    expect(graduatedState).toBe("review");

    const withLapse = replayToReviewRows([3, 3, 3, 1], new Date("2026-08-01T00:00:00.000Z"), 3);
    const lapseRow = withLapse[3]!;
    expect(lapseRow.state_before).toBe("review");
    expect(lapseRow.rating).toBe(1);
    const result = rebuildOneItem(withLapse);
    expect(result.lapses).toBe(1);
  });

  it("elapsed time between reviews affects the real scheduler's output, and rebuildOneItem reproduces it exactly regardless of spacing", () => {
    const closeTogether = replayToReviewRows([3, 3], new Date("2026-08-01T00:00:00.000Z"), 1);
    const farApart = replayToReviewRows([3, 3], new Date("2026-08-01T00:00:00.000Z"), 30);
    const closeResult = rebuildOneItem(closeTogether);
    const farResult = rebuildOneItem(farApart);
    // Different real elapsed time between reviews produces different real
    // stability -- if these came out equal, something is silently ignoring
    // the actual reviewed_at spacing (e.g. defaulting to `now()`).
    expect(closeResult.stability).not.toBe(farResult.stability);
    expect(closeResult.stability).toBe(closeTogether[1]!.stability_after);
    expect(farResult.stability).toBe(farApart[1]!.stability_after);
  });

  it("is idempotent: calling twice on the same input produces byte-identical output", () => {
    const rows = replayToReviewRows([3, 1, 4, 2], new Date("2026-08-01T00:00:00.000Z"), 5);
    const first = rebuildOneItem(rows);
    const second = rebuildOneItem(rows);
    expect(second).toEqual(first);
  });

  it("state is a direct passthrough of the latest review's state_after -- no scheduler call", () => {
    const rows = replayToReviewRows([3, 1, 2], new Date("2026-08-01T00:00:00.000Z"), 2);
    const result = rebuildOneItem(rows);
    expect(result.state).toBe(rows[rows.length - 1]!.state_after);
  });

  it("learning_steps is a direct passthrough of the latest review's learning_steps_after (R17) -- no scheduler call", () => {
    const rows = replayToReviewRows([3, 3], new Date("2026-08-01T00:00:00.000Z"), 3);
    const result = rebuildOneItem(rows);
    expect(result.learning_steps).toBe(rows[rows.length - 1]!.learning_steps_after);
  });

  it("R17 completeness: a card_states row REBUILT from the log carries enough learning_steps information for a real SECOND round-trip to graduate correctly -- closes the same 'is this field on the log at all' gap R1.5 exists to close, for this field specifically", () => {
    // Same shape as Eng 2's own fsrs-scheduler.test.ts red test, going
    // through THIS module's rebuild path instead of live card_states. ONE
    // real Good (held in memory purely to generate a known-correct
    // fixture -- with real learning_steps threading, one Good never
    // graduates alone; two DOES, so a two-review fixture here would have
    // already graduated before there was anything left to prove).
    const t1 = new Date("2026-09-02T12:00:00Z");
    const rows = replayToReviewRows([3], t1, 0);
    const rebuilt = rebuildOneItem(rows);
    expect(rebuilt.state).toBe("learning"); // sanity: one Good never graduates alone (matches Eng 2's own first assertion)
    expect(rebuilt.learning_steps).toBe(1); // sanity: the real step counter after one Good, not silently 0

    // The actual claim: rebuild the DbCardState shape toFsrsCard consumes
    // (what a real re-hydration reads), from the REBUILT cache values
    // (never from `rows` directly) -- if learning_steps had been silently
    // dropped or defaulted during rebuild, this would reproduce Eng 2's bug
    // even though the underlying reviews log had the real value all along.
    // (This assumes fsrs-scheduler.ts's own R17 fix -- DbCardState gaining
    // a `learningSteps` field, toFsrsCard reading it -- has landed; LifeOS
    // Eng 1 owns that file. If this test ever regresses to State.Learning
    // after their fix lands, that is a real bug in THIS module's rebuild
    // path, not theirs -- everything upstream of `cacheAsDbCardState` here
    // is this file's own code.)
    const cacheAsDbCardState = {
      stability: rebuilt.stability,
      difficulty: rebuilt.difficulty,
      dueAt: rebuilt.due_at,
      reps: rebuilt.reps,
      lapses: rebuilt.lapses,
      state: rebuilt.state,
      lastReviewAt: rebuilt.last_review_at,
      learningSteps: rebuilt.learning_steps,
    };
    const t2 = new Date("2026-09-02T12:15:00Z"); // 15 min later -- same gap Eng 2's test uses, not a timing gate
    const rehydrated = toFsrsCard(cacheAsDbCardState, t2);
    const scheduler = getScheduler();
    const { card: afterSecond } = computeNextState(scheduler, rehydrated, 3, t2);
    expect(afterSecond.state).toBe(State.Review); // graduates -- the cache preserved what it needed to
  });

  it("throws on an empty review list rather than silently returning a default snapshot", () => {
    expect(() => rebuildOneItem([])).toThrow();
  });

  it("review order in the input array does not matter -- rebuildOneItem sorts by reviewed_at itself", () => {
    const rows = replayToReviewRows([3, 3, 1], new Date("2026-08-01T00:00:00.000Z"), 4);
    const shuffled = [rows[2]!, rows[0]!, rows[1]!];
    expect(rebuildOneItem(shuffled)).toEqual(rebuildOneItem(rows));
  });
});
