import { describe, expect, it } from "vitest";
import { computeHabitDecayScore, HABIT_DECAY_FACTOR, HABIT_VOTE_WEIGHT } from "../decay-score";
import { localDateString } from "@/lib/date-utils";

describe("computeHabitDecayScore", () => {
  it("returns 0 for a habit with no votes ever", () => {
    expect(computeHabitDecayScore([], "2026-09-14")).toBe(0);
  });

  it("converges toward 100% under steady daily voting", () => {
    // 60 consecutive daily votes, asked as of the last one -- the
    // recurrence's steady state is score = score*0.96 + 0.04 => score = 1,
    // so a long unbroken streak should land close to (never exactly) 1.
    const votes: string[] = [];
    const start = new Date(Date.UTC(2026, 6, 1)); // 2026-07-01
    for (let i = 0; i <= 60; i++) {
      const d = new Date(start.getTime() + i * 86_400_000);
      votes.push(d.toISOString().slice(0, 10));
    }
    const asOf = votes[votes.length - 1]!; // last voted day
    const score = computeHabitDecayScore(votes, asOf);
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThan(1);
  });

  it("decays a missed stretch back toward 0", () => {
    // A single vote 20 days before "today," nothing since.
    const score = computeHabitDecayScore(["2026-08-01"], "2026-08-21");
    const expected = HABIT_VOTE_WEIGHT * Math.pow(HABIT_DECAY_FACTOR, 20);
    expect(score).toBeCloseTo(expected, 10);
    expect(score).toBeLessThan(0.02); // 0.04 * 0.96^20 ~= 0.0177
  });

  it("a vote 30 days ago contributes exactly 0.04 * 0.96^30", () => {
    const score = computeHabitDecayScore(["2026-08-01"], "2026-08-31");
    expect(score).toBeCloseTo(0.04 * Math.pow(0.96, 30), 12);
  });

  it("sums independent contributions from multiple past votes (closed form, not a day-by-day loop)", () => {
    const score = computeHabitDecayScore(["2026-08-01", "2026-08-15"], "2026-08-31");
    const expected = 0.04 * Math.pow(0.96, 30) + 0.04 * Math.pow(0.96, 16);
    expect(score).toBeCloseTo(expected, 12);
  });

  it("ignores a vote dated after asOfDateStr rather than amplifying it", () => {
    const score = computeHabitDecayScore(["2026-09-20"], "2026-09-14");
    expect(score).toBe(0);
  });

  it("a vote at 11pm local still counts for that local calendar day, not the UTC day it rolls into", () => {
    // 11:00 PM in America/Los_Angeles on 2026-09-13 is already 2026-09-14
    // in UTC. The vote log must key off the LOCAL date the write path
    // derives via localDateString, not a UTC slice of the instant -- this
    // is exactly AGENTS.md's "never derive a calendar date from a raw
    // Date" rule, exercised end-to-end through this module's own math.
    const elevenPmLocal = new Date("2026-09-14T06:00:00.000Z"); // 2026-09-13 23:00 PDT
    const voteLocalDate = localDateString(elevenPmLocal, "America/Los_Angeles");
    expect(voteLocalDate).toBe("2026-09-13");

    // Reviewed the next local morning: the vote is exactly one local day
    // old, not zero (which a UTC-date bug would produce, since the UTC
    // instant already reads 2026-09-14).
    const reviewedAsOf = "2026-09-14";
    const score = computeHabitDecayScore([voteLocalDate], reviewedAsOf);
    expect(score).toBeCloseTo(HABIT_VOTE_WEIGHT * HABIT_DECAY_FACTOR, 12);

    // And it must NOT be treated as same-day (which would give 0.04 flat).
    expect(score).not.toBeCloseTo(HABIT_VOTE_WEIGHT, 6);
  });

  it("a duplicate date in the input double-counts (callers rely on the DB's unique constraint, not this function, to prevent duplicates)", () => {
    const single = computeHabitDecayScore(["2026-09-01"], "2026-09-01");
    const doubled = computeHabitDecayScore(["2026-09-01", "2026-09-01"], "2026-09-01");
    expect(doubled).toBeCloseTo(single * 2, 12);
  });

  // P3-07: pause freezes decay. Migration 202's own header has the full
  // product reasoning -- every day paused is excluded from a vote's
  // days-elapsed count, so a pause protects the score the same way an
  // active vote would, without requiring one.
  describe("pauseRanges", () => {
    it("with no pause ranges, behaves exactly as before (default [])", () => {
      const withDefault = computeHabitDecayScore(["2026-08-01"], "2026-08-21");
      const withEmpty = computeHabitDecayScore(["2026-08-01"], "2026-08-21", []);
      expect(withDefault).toBe(withEmpty);
    });

    it("a CLOSED pause window fully spanning the gap freezes the score at exactly the vote's own contribution", () => {
      // Voted once on 08-01, paused THAT SAME DAY through 08-21 -- zero
      // real days elapsed against the vote (the habit was active for zero
      // days between casting the vote and going on pause).
      const score = computeHabitDecayScore(["2026-08-01"], "2026-08-21", [
        { pausedAt: "2026-08-01", resumedAt: "2026-08-21" },
      ]);
      expect(score).toBeCloseTo(HABIT_VOTE_WEIGHT, 10); // 0.96^0 * 0.04
    });

    it("a STILL-OPEN pause (resumedAt: null) excludes every day through asOfDateStr, same as a closed one ending exactly there", () => {
      const open = computeHabitDecayScore(["2026-08-01"], "2026-08-21", [{ pausedAt: "2026-08-01", resumedAt: null }]);
      const closed = computeHabitDecayScore(["2026-08-01"], "2026-08-21", [
        { pausedAt: "2026-08-01", resumedAt: "2026-08-21" },
      ]);
      expect(open).toBeCloseTo(closed, 12);
    });

    it("a pause BEFORE the vote was ever cast excludes nothing -- only days AFTER the vote count", () => {
      // Paused 07-01..07-15 (before the habit existed/voted), voted 08-01,
      // reviewed 08-11 -- the pause is irrelevant to this vote's own decay.
      const withIrrelevantPause = computeHabitDecayScore(["2026-08-01"], "2026-08-11", [
        { pausedAt: "2026-07-01", resumedAt: "2026-07-15" },
      ]);
      const withNoPause = computeHabitDecayScore(["2026-08-01"], "2026-08-11");
      expect(withIrrelevantPause).toBeCloseTo(withNoPause, 12);
    });

    it("a PARTIAL overlap only excludes the days that actually fall within [voteDate, asOfDateStr]", () => {
      // Voted 08-01. Paused 07-25..08-05 (starts before the vote, ends
      // after it) -- only 08-01..08-05 (4 days) should be excluded, not the
      // whole range.
      const score = computeHabitDecayScore(["2026-08-01"], "2026-08-11", [
        { pausedAt: "2026-07-25", resumedAt: "2026-08-05" },
      ]);
      // Raw gap is 10 days; 4 of them (08-01 through 08-05) are paused, so
      // effective days-ago is 6.
      expect(score).toBeCloseTo(HABIT_VOTE_WEIGHT * Math.pow(HABIT_DECAY_FACTOR, 6), 10);
    });

    it("multiple pause cycles each only offset the votes cast AFTER they ended -- a vote between two pauses isn't double-protected by the earlier one", () => {
      // Vote A on 08-01. Pause 1: 08-02..08-06 (4 elapsed days). Vote B on
      // 08-10 (cast while active, after pause 1 ended). Pause 2: 08-15..08-20
      // (5 elapsed days, opens after vote B). Reviewed 08-25.
      const pauseRanges = [
        { pausedAt: "2026-08-02", resumedAt: "2026-08-06" },
        { pausedAt: "2026-08-15", resumedAt: "2026-08-20" },
      ];
      const score = computeHabitDecayScore(["2026-08-01", "2026-08-10"], "2026-08-25", pauseRanges);

      // Vote A (08-01): raw 24 days to 08-25, minus BOTH pauses (4 + 5 = 9
      // paused days both fall after 08-01) => 15 effective days.
      // Vote B (08-10): raw 15 days to 08-25, minus ONLY pause 2 (pause 1
      // ended 08-06, entirely BEFORE vote B was cast, so it contributes
      // nothing to vote B's own exclusion) => 15 - 5 = 10 effective days.
      const expected =
        HABIT_VOTE_WEIGHT * Math.pow(HABIT_DECAY_FACTOR, 15) + HABIT_VOTE_WEIGHT * Math.pow(HABIT_DECAY_FACTOR, 10);
      expect(score).toBeCloseTo(expected, 10);
    });

    it("never goes negative (a malformed/overlapping range set still degrades to floor 0 effective days, not a boosted score)", () => {
      const score = computeHabitDecayScore(["2026-08-20"], "2026-08-21", [
        { pausedAt: "2026-01-01", resumedAt: "2026-12-31" }, // wildly overshoots the gap
      ]);
      expect(score).toBeCloseTo(HABIT_VOTE_WEIGHT, 10); // clamped to 0 effective days-ago, not negative
    });
  });
});

describe("computeHabitDecayScore ratePerDay (HABIT-FREQ)", () => {
  const asOf = "2026-10-05";
  const dayStrings = (n: number, stepDays: number) =>
    Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 9, 5 - i * stepDays)).toISOString().slice(0, 10));

  it("the default rate is 1: every existing caller computes exactly the score it always did", () => {
    const votes = ["2026-10-05", "2026-10-03", "2026-09-30"];
    expect(computeHabitDecayScore(votes, asOf, [], 1)).toBe(computeHabitDecayScore(votes, asOf));
    expect(computeHabitDecayScore(votes, asOf, [], 1)).toBeCloseTo(0.04 * (1 + 0.96 ** 2 + 0.96 ** 5), 12);
  });

  it("a steady WEEKLY voter converges toward 1.0 (without the rate it would sit near 0.2 and read as failing)", () => {
    const weeklyVotes = dayStrings(100, 7); // a vote exactly every 7 days for ~2 years (score = 1 - 0.96^votes)
    const withRate = computeHabitDecayScore(weeklyVotes, asOf, [], 1 / 7);
    const withoutRate = computeHabitDecayScore(weeklyVotes, asOf);
    expect(withRate).toBeGreaterThan(0.9);
    expect(withoutRate).toBeLessThan(0.3);
  });

  it("a steady every-3-days voter and a steady daily voter both converge to ~1", () => {
    expect(computeHabitDecayScore(dayStrings(100, 3), asOf, [], 1 / 3)).toBeGreaterThan(0.9);
    expect(computeHabitDecayScore(dayStrings(120, 1), asOf, [], 1)).toBeGreaterThan(0.97);
  });

  it("still decays when the habit is neglected, in units of its own expected gap", () => {
    const stoppedFourWeeksAgo = dayStrings(30, 7).map((d) => new Date(Date.parse(d) - 28 * 86400000).toISOString().slice(0, 10));
    const fresh = computeHabitDecayScore(dayStrings(30, 7), asOf, [], 1 / 7);
    const stale = computeHabitDecayScore(stoppedFourWeeksAgo, asOf, [], 1 / 7);
    expect(stale).toBeLessThan(fresh);
    expect(stale / fresh).toBeCloseTo(0.96 ** 4, 2); // four missed weekly gaps = four decay steps
  });

  it("a non-positive or non-finite rate falls back to daily rather than freezing or amplifying the decay", () => {
    const votes = ["2026-09-25"];
    const daily = computeHabitDecayScore(votes, asOf);
    for (const bad of [0, -1, NaN, Infinity]) expect(computeHabitDecayScore(votes, asOf, [], bad)).toBe(daily);
  });
});
