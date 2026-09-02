import { describe, expect, it } from "vitest";
import { createEmptyCard, State } from "ts-fsrs";
import { getScheduler, computeNextState, toFsrsCard, toRpcNextState, DEFAULT_REQUEST_RETENTION, type DbCardState } from "../fsrs-scheduler";

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

/**
 * R1.6/R17, 2026-09-02: found live in production, not in a fixture. ts-fsrs
 * tracks WHICH learning step a card is on via `card.learning_steps` (an
 * integer index into `learning_steps`/`relearning_steps`, default
 * `['1m','10m']` here -- unconfigured, so the library default applies).
 * That counter is read in ts-fsrs's own `getLearningInfo`
 * (node_modules/ts-fsrs/dist/index.umd.js:1035, `card.learning_steps =
 * card.learning_steps || 0`) and drives `BasicLearningStepsStrategy`
 * (index.umd.js:287), whose signature is `(params, state, cur_step)` --
 * a step-COUNT lookup, never a timestamp. Graduation out of `learning`
 * happens when the strategy has no next step to offer for the rating just
 * given (index.umd.js:328-336, the `Rating.Good` branch: only set `if
 * (next_info)` -- i.e. only while a next step exists).
 *
 * `card_states` HAS NO COLUMN for this counter, and `toFsrsCard` (this
 * file) hardcodes `learning_steps: 0` on every reconstruction from a DB
 * row. So every SEPARATE `submit_review` call -- which is every real
 * review, since each is its own request re-hydrating the card fresh from
 * `card_states` -- tells ts-fsrs the card is on its FIRST learning step,
 * no matter how many times it has actually been graded. A card that only
 * ever receives Again/Hard/Good ratings across two or more real sessions
 * can therefore never graduate to `review`: it re-offers every ~1-10
 * minutes, forever. (Easy is unaffected -- ts-fsrs's learning-steps
 * strategy never defines an Easy branch at all, so Easy always graduates
 * in one shot regardless of the counter. Relearning is unaffected too --
 * its default ladder is a single step, so "reset to 0" loses no
 * information there. Both were independently verified live: an
 * Easy-then-Again production sequence matched a written prediction to the
 * digit; a Good-then-Good sequence did not, which is what surfaced this.)
 *
 * THIS TEST MUST CROSS THE PERSISTENCE BOUNDARY TO SEE THE BUG. A version
 * that holds the in-memory `Card` object across both Goods (`current =
 * card`, no round trip) cannot fail here -- that is exactly the shape of
 * the R1.6 scratch proof that built multi-review fixtures reaching
 * `review` state without ever exercising this defect, because it never
 * re-hydrated through `toFsrsCard` between steps the way a real second
 * session does. So this test goes through `toRpcNextState` -> a
 * `DbCardState`-shaped object (what `submit_review` actually persists) ->
 * `toFsrsCard` (what the next session actually reads back), matching the
 * real client's round trip in `retrieval-session-overlay.tsx`'s
 * `handleGrade`, not a shortcut around it.
 */
describe("toFsrsCard round-trip — card_states must persist learning_steps, or a card can never graduate out of 'learning'", () => {
  it("two Good ratings, re-hydrated through the DbCardState shape between them, must reach 'review' -- currently fails, because card_states has no learning_steps column", () => {
    const scheduler = getScheduler(DEFAULT_REQUEST_RETENTION);
    const t1 = new Date("2026-09-02T12:00:00Z");
    // 15 minutes later -- well past the default 10-minute second learning
    // step. If this test ever starts failing on a TIMING assumption once
    // the fix lands, that is a real regression to report, not a fixture to
    // loosen: the point of this gap is to prove graduation is not gated by
    // elapsed time (falsified live, 2026-09-02 -- 8 consecutive Goods, 15
    // minutes apart, never once graduated under the current code).
    const t2 = new Date("2026-09-02T12:15:00Z");

    const { card: afterFirst } = computeNextState(scheduler, toFsrsCard(null, t1), 3, t1);
    expect(afterFirst.state).toBe(State.Learning); // sanity: first Good never graduates on its own

    // Cross the persistence boundary. This object is exactly the shape
    // `submit_review` stores and the next session's `toFsrsCard` reads --
    // never hold `afterFirst` itself across the two Goods.
    const persisted: DbCardState = {
      state: toRpcNextState(afterFirst).state,
      stability: afterFirst.stability,
      difficulty: afterFirst.difficulty,
      dueAt: afterFirst.due.toISOString(),
      reps: afterFirst.reps,
      lapses: afterFirst.lapses,
      lastReviewAt: t1.toISOString(),
      // The field this test exists about. `submit_review` stores it (column
      // added by 111), so a fixture claiming to be "exactly the shape
      // submit_review stores" must carry it. Omitting it here was faithful
      // when the column did not exist and is now the one thing that would
      // make this test lie in the passing direction.
      learningSteps: afterFirst.learning_steps,
    };

    const rehydrated = toFsrsCard(persisted, t2);
    const { card: afterSecond } = computeNextState(scheduler, rehydrated, 3, t2);

    // THE assertion this test exists to defend: a second Good, reached
    // through a real session boundary, must graduate the card. Today it
    // does not -- `rehydrated` looks like a first-ever review regardless of
    // the real history, so this fails with `afterSecond.state ===
    // State.Learning`. Fix (R17): persist `learning_steps` on
    // `card_states`/`reviews` and stop hardcoding it to 0 here.
    expect(afterSecond.state).toBe(State.Review);
  });
});
