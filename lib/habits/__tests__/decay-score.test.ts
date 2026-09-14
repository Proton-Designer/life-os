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
});
