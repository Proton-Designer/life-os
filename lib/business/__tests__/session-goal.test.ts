import { describe, expect, it } from "vitest";
import { MAX_GOAL_MINUTES, goalEndsAtIso, goalProgress, parseGoalMinutes, parseGoalMinutesText } from "../session-goal";

describe("parseGoalMinutes", () => {
  it("combines hours and minutes into a total", () => {
    expect(parseGoalMinutes(1, 30)).toBe(90);
    expect(parseGoalMinutes(0, 45)).toBe(45);
    expect(parseGoalMinutes(2, 0)).toBe(120);
  });

  it("rejects zero", () => {
    expect(() => parseGoalMinutes(0, 0)).toThrow(/longer than zero/);
  });

  it("rejects negative hours or minutes", () => {
    expect(() => parseGoalMinutes(-1, 0)).toThrow(/negative/);
    expect(() => parseGoalMinutes(0, -5)).toThrow(/negative/);
  });

  it("rejects NaN", () => {
    expect(() => parseGoalMinutes(NaN, 0)).toThrow(/whole number/);
    expect(() => parseGoalMinutes(0, NaN)).toThrow(/whole number/);
  });

  it("rejects non-integer values", () => {
    expect(() => parseGoalMinutes(1.5, 0)).toThrow(/whole number/);
    expect(() => parseGoalMinutes(0, 30.5)).toThrow(/whole number/);
  });

  it("rejects minutes outside 0-59 rather than normalising", () => {
    expect(() => parseGoalMinutes(0, 60)).toThrow(/0 and 59/);
    expect(() => parseGoalMinutes(0, 75)).toThrow(/0 and 59/);
  });

  describe("the 8-hour cap is on the TOTAL, not each field independently", () => {
    it("accepts exactly 8 hours", () => {
      expect(parseGoalMinutes(8, 0)).toBe(MAX_GOAL_MINUTES);
    });

    it("rejects 8 hours plus any nonzero minutes, even though minutes alone is in range", () => {
      expect(() => parseGoalMinutes(8, 1)).toThrow(/at most 8 hours/);
      expect(() => parseGoalMinutes(8, 59)).toThrow(/at most 8 hours/);
    });

    it("rejects a total over the cap reached any other way", () => {
      expect(() => parseGoalMinutes(9, 0)).toThrow(/at most 8 hours/);
    });
  });
});

describe("parseGoalMinutesText", () => {
  it("parses a bare whole number of minutes", () => {
    expect(parseGoalMinutesText("90")).toBe(90);
    expect(parseGoalMinutesText("5")).toBe(5);
  });

  it("trims surrounding whitespace", () => {
    expect(parseGoalMinutesText("  45  ")).toBe(45);
  });

  it("rejects empty input", () => {
    expect(() => parseGoalMinutesText("")).toThrow(/whole number/);
    expect(() => parseGoalMinutesText("   ")).toThrow(/whole number/);
  });

  it("rejects zero", () => {
    expect(() => parseGoalMinutesText("0")).toThrow(/longer than zero/);
  });

  it("rejects a negative sign", () => {
    expect(() => parseGoalMinutesText("-5")).toThrow(/whole number/);
  });

  it("rejects a decimal", () => {
    expect(() => parseGoalMinutesText("30.5")).toThrow(/whole number/);
  });

  it("rejects non-numeric formats someone might reasonably type", () => {
    expect(() => parseGoalMinutesText("1h30m")).toThrow(/whole number/);
    expect(() => parseGoalMinutesText("1:30")).toThrow(/whole number/);
    expect(() => parseGoalMinutesText("ninety")).toThrow(/whole number/);
  });

  it("rejects a total over the 8-hour cap", () => {
    expect(() => parseGoalMinutesText("481")).toThrow(/at most 8 hours/);
  });

  it("accepts exactly the cap", () => {
    expect(parseGoalMinutesText("480")).toBe(480);
  });
});

describe("goalProgress", () => {
  const STARTED = "2026-09-10T18:00:00.000Z";

  it("reports zero elapsed and zero fraction at the start", () => {
    const p = goalProgress(STARTED, 30, new Date(STARTED));
    expect(p).toEqual({ elapsedMinutes: 0, goalMinutes: 30, fraction: 0, reached: false });
  });

  it("computes a fractional progress partway through", () => {
    const p = goalProgress(STARTED, 30, new Date("2026-09-10T18:15:00.000Z"));
    expect(p.elapsedMinutes).toBe(15);
    expect(p.fraction).toBe(0.5);
    expect(p.reached).toBe(false);
  });

  it("reaches exactly at the goal", () => {
    const p = goalProgress(STARTED, 30, new Date("2026-09-10T18:30:00.000Z"));
    expect(p.reached).toBe(true);
    expect(p.fraction).toBe(1);
  });

  it("clamps the fraction to 1 rather than reporting over-progress", () => {
    const p = goalProgress(STARTED, 30, new Date("2026-09-10T20:00:00.000Z"));
    expect(p.elapsedMinutes).toBe(120);
    expect(p.fraction).toBe(1);
    expect(p.reached).toBe(true);
  });

  it("never reports negative elapsed or fraction, even for a clock skewed before start", () => {
    const p = goalProgress(STARTED, 30, new Date("2026-09-10T17:00:00.000Z"));
    expect(p.elapsedMinutes).toBe(0);
    expect(p.fraction).toBe(0);
    expect(p.reached).toBe(false);
  });
});

describe("goalEndsAtIso — the auto-end timestamp rule", () => {
  const STARTED = "2026-09-10T18:00:00.000Z";

  it("is started_at plus goal_minutes, nothing else", () => {
    expect(goalEndsAtIso(STARTED, 30)).toBe("2026-09-10T18:30:00.000Z");
    expect(goalEndsAtIso(STARTED, 90)).toBe("2026-09-10T19:30:00.000Z");
  });

  it("crosses a day boundary correctly, as plain instant arithmetic (no calendar-date logic involved)", () => {
    expect(goalEndsAtIso("2026-09-10T23:45:00.000Z", 30)).toBe("2026-09-11T00:15:00.000Z");
  });

  // THE case the Lead named explicitly: a session left running past its
  // goal, found long after the fact (a tab closed overnight, or the app
  // simply not open when the goal passed).
  describe("the reopened-tab case", () => {
    it("computes the same ended_at whether checked the instant the goal passes or 14 hours later", () => {
      const rightAtGoal = goalEndsAtIso(STARTED, 30);
      // goalEndsAtIso takes no `now` — there is nothing to pass "14 hours
      // later" as. That is the point: proving it structurally rather than
      // by threading a late `now` through and hoping the function ignores
      // it, since it has no parameter to ignore.
      const reopenedMuchLater = goalEndsAtIso(STARTED, 30);
      expect(reopenedMuchLater).toBe(rightAtGoal);
      expect(reopenedMuchLater).toBe("2026-09-10T18:30:00.000Z");
    });

    it("records a 30-minute duration, not a 14-hour one, when a 30-minute-goal session is found long after the fact", () => {
      const goalMinutes = 30;
      const foundAt = new Date("2026-09-11T08:00:00.000Z"); // 14 hours after STARTED
      const progress = goalProgress(STARTED, goalMinutes, foundAt);
      expect(progress.reached).toBe(true);

      // The WRONG thing a naive implementation might do: record `foundAt`
      // (or `new Date()`) as ended_at. Assert the two disagree, so this test
      // would fail loudly if goalEndsAtIso were ever changed to accept and
      // use a `now`.
      const correctEndedAt = goalEndsAtIso(STARTED, goalMinutes);
      expect(correctEndedAt).not.toBe(foundAt.toISOString());
      expect(correctEndedAt).toBe("2026-09-10T18:30:00.000Z");

      const wrongDurationMinutes = (foundAt.getTime() - new Date(STARTED).getTime()) / 60_000;
      const rightDurationMinutes = (new Date(correctEndedAt).getTime() - new Date(STARTED).getTime()) / 60_000;
      expect(rightDurationMinutes).toBe(30);
      expect(wrongDurationMinutes).toBe(14 * 60);
      expect(rightDurationMinutes).not.toBe(wrongDurationMinutes);
    });
  });
});
