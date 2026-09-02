import { describe, expect, it } from "vitest";
import { dayWonVerdict } from "../day-won";

// index 0 = Sunday … 6 = Saturday, matching migration 122's column comment.
const WEEK = [0, 4, 4, 4, 4, 4, 2];

/**
 * R58: Day Won = a baseline exists for today's weekday AND it is > 0 AND hours
 * ≥ baseline. A baseline of 0 reads "rest day" and is never won or lost. No
 * baseline at all means the comparison is ABSENT.
 *
 * Four outcomes, not two. Collapsing them into won/not-won is the whole trap:
 * it turns "you never told me what a normal day looks like" and "you planned to
 * rest" both into "you failed", which is a judgement the data does not support.
 */
describe("dayWonVerdict — four outcomes, because absent and rest are not failure", () => {
  it("hours at or above the baseline is WON", () => {
    expect(dayWonVerdict(240, WEEK, 1)).toEqual({ kind: "won", hoursMinutes: 240, baselineHours: 4 });
  });

  it("exactly the baseline is won — the bar is inclusive", () => {
    expect(dayWonVerdict(240, WEEK, 2).kind).toBe("won");
  });

  it("one minute under is SHORT, and says by how much", () => {
    expect(dayWonVerdict(239, WEEK, 1)).toEqual({
      kind: "short",
      hoursMinutes: 239,
      baselineHours: 4,
      shortByMinutes: 1,
    });
  });

  /**
   * A zero baseline is a deliberate rest day. It is not a bar of zero that any
   * amount of work clears — calling it "won" would congratulate someone for
   * working on the day they planned not to.
   */
  it("a zero baseline is REST, whatever the hours", () => {
    expect(dayWonVerdict(0, WEEK, 0)).toEqual({ kind: "rest" });
    expect(dayWonVerdict(300, WEEK, 0)).toEqual({ kind: "rest" });
  });

  /**
   * The distinction migration 122 exists for. No baselines at all means the
   * user has never been asked — not that they set a target of zero and missed
   * it.
   */
  it("no baselines at all is ABSENT, never a zero baseline", () => {
    expect(dayWonVerdict(150, null, 3)).toEqual({ kind: "absent" });
  });

  it("zero hours against a real baseline is short, not absent", () => {
    expect(dayWonVerdict(0, WEEK, 1)).toEqual({
      kind: "short",
      hoursMinutes: 0,
      baselineHours: 4,
      shortByMinutes: 240,
    });
  });

  /**
   * A malformed array is absent, not a crash and not a guess. Migration 122's
   * CHECK makes a 7-length array with no nulls the only storable shape, but
   * this is a separate entry point — the same reason assignRanks guards its own
   * inputs even though star() caps at three.
   */
  it("a short array is absent rather than reading past its end", () => {
    expect(dayWonVerdict(150, [4, 4], 5)).toEqual({ kind: "absent" });
  });

  it("an out-of-range weekday index is absent, not a wrap-around", () => {
    expect(dayWonVerdict(150, WEEK, 7)).toEqual({ kind: "absent" });
    expect(dayWonVerdict(150, WEEK, -1)).toEqual({ kind: "absent" });
  });

  it("Saturday's own baseline is used, not the week's average", () => {
    // Saturday is 2h; 150 minutes clears it while falling short of a weekday.
    expect(dayWonVerdict(150, WEEK, 6).kind).toBe("won");
    expect(dayWonVerdict(150, WEEK, 3).kind).toBe("short");
  });
});
