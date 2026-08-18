import { describe, expect, it } from "vitest";
import { computeHabitRollingRate, buildHabitConsistencyRows } from "../habit-consistency";

describe("computeHabitRollingRate", () => {
  it("counts fully-elapsed days over the window when the habit predates it", () => {
    const habit = { id: "h1", name: "Fajr habit", committedDate: "2026-01-01" };
    const logs = [
      { habitId: "h1", date: "2026-08-01", completed: true },
      { habitId: "h1", date: "2026-08-02", completed: false },
      { habitId: "h1", date: "2026-08-03", completed: true },
    ];
    // today = 08-03, so 08-01/08-02 are fully elapsed and 08-03 (today) only
    // counts because it was completed — done/total both land on the same
    // number here (2/3) as if today counted normally, since today happens
    // to be completed; see the dedicated "today doesn't count against you"
    // tests below for the case where that coincidence doesn't hold.
    const result = computeHabitRollingRate(habit, logs, "2026-08-01", "2026-08-03");
    expect(result).toEqual({ done: 2, total: 3 });
  });

  it("floors the window at the habit's own committed_date, not counting days before it existed", () => {
    const habit = { id: "h1", name: "New habit", committedDate: "2026-08-02" };
    const logs = [{ habitId: "h1", date: "2026-08-02", completed: true }];
    // Window asks for 2026-08-01..2026-08-03 (today), but the habit didn't
    // exist on 08-01. 08-02 is fully elapsed (done). 08-03 is today,
    // unlogged, so it doesn't enter the denominator at all.
    const result = computeHabitRollingRate(habit, logs, "2026-08-01", "2026-08-03");
    expect(result).toEqual({ done: 1, total: 1 });
  });

  it("only counts logs for the matching habit id", () => {
    const habit = { id: "h1", name: "Habit 1", committedDate: "2026-08-01" };
    const logs = [
      { habitId: "h1", date: "2026-08-01", completed: true },
      { habitId: "h2", date: "2026-08-01", completed: true },
    ];
    // Single-day window where that day is today and it's completed.
    const result = computeHabitRollingRate(habit, logs, "2026-08-01", "2026-08-01");
    expect(result).toEqual({ done: 1, total: 1 });
  });

  it("treats an unlogged fully-elapsed day as not done, not as missing data", () => {
    const habit = { id: "h1", name: "Habit 1", committedDate: "2026-08-01" };
    // today = 08-05: 08-01..08-04 are fully elapsed (4 unlogged misses);
    // 08-05 (today) is unlogged, so it's excluded from the denominator.
    const result = computeHabitRollingRate(habit, [], "2026-08-01", "2026-08-05");
    expect(result).toEqual({ done: 0, total: 4 });
  });

  // The bug this section guards against: an unfinished "today" used to
  // count as a denominator miss, so a habit committed this morning and not
  // yet done read "0/1" — the worst possible first impression, and the
  // same hard-reset-streak failure shape in arithmetic form. Today must
  // only ever help the rate, never hurt it — mirrors computeHabitStreak's
  // existing "skip today unless completed" convention.
  describe("today can only help, never hurt (mirrors computeHabitStreak's convention)", () => {
    it("a habit committed today, not yet done today, reads 0/0 — not 0/1", () => {
      const habit = { id: "h1", name: "Brand new habit", committedDate: "2026-08-15" };
      const result = computeHabitRollingRate(habit, [], "2026-07-17", "2026-08-15");
      expect(result).toEqual({ done: 0, total: 0 });
    });

    it("an established habit, not yet done today, doesn't have today counted against it", () => {
      const habit = { id: "h1", name: "Established habit", committedDate: "2026-01-01" };
      const logs = [
        { habitId: "h1", date: "2026-08-13", completed: true },
        { habitId: "h1", date: "2026-08-14", completed: true },
        // 2026-08-15 (today) has no log at all — not yet done, day not over.
      ];
      const result = computeHabitRollingRate(habit, logs, "2026-08-13", "2026-08-15");
      // Only 08-13 and 08-14 (fully elapsed) enter the denominator; today is excluded.
      expect(result).toEqual({ done: 2, total: 2 });
    });

    it("completing the habit today adds to both done and total (today can help)", () => {
      const habit = { id: "h1", name: "Established habit", committedDate: "2026-01-01" };
      const logs = [
        { habitId: "h1", date: "2026-08-13", completed: true },
        { habitId: "h1", date: "2026-08-14", completed: false },
        { habitId: "h1", date: "2026-08-15", completed: true }, // today, done
      ];
      const result = computeHabitRollingRate(habit, logs, "2026-08-13", "2026-08-15");
      expect(result).toEqual({ done: 2, total: 3 });
    });

    it("09:00-local vs. just-after-midnight: the same day flips from excluded-as-today to a counted past day once the calendar advances", () => {
      const habit = { id: "h1", name: "Habit", committedDate: "2026-01-01" };
      // No log at all for 08-15.
      const logs: { habitId: string; date: string; completed: boolean }[] = [];

      // 09:00 local on 2026-08-15: today is still 08-15, unfinished, excluded.
      const duringTheDay = computeHabitRollingRate(habit, logs, "2026-08-15", "2026-08-15");
      expect(duringTheDay).toEqual({ done: 0, total: 0 });

      // Just after local midnight: today is now 08-16, so 08-15 is a fully
      // elapsed past day and its lack of a log now counts as a real miss.
      const afterMidnight = computeHabitRollingRate(habit, logs, "2026-08-15", "2026-08-16");
      expect(afterMidnight).toEqual({ done: 0, total: 1 });
    });
  });
});

describe("buildHabitConsistencyRows", () => {
  const days = ["2026-08-01", "2026-08-02", "2026-08-03"];

  it("builds one row per habit, labeled by name", () => {
    const rows = buildHabitConsistencyRows(
      [
        { id: "h1", name: "Fajr habit", committedDate: "2026-08-01" },
        { id: "h2", name: "Qur'an habit", committedDate: "2026-08-01" },
      ],
      [],
      days,
      "2026-08-03"
    );
    expect(rows.map((r) => r.label)).toEqual(["Fajr habit", "Qur'an habit"]);
  });

  it("marks a logged-complete day as done and a fully-elapsed unlogged day as missed", () => {
    const rows = buildHabitConsistencyRows(
      [{ id: "h1", name: "Fajr habit", committedDate: "2026-08-01" }],
      [{ habitId: "h1", date: "2026-08-01", completed: true }],
      days,
      "2026-08-03"
    );
    expect(rows[0].cells).toEqual([
      { date: "2026-08-01", status: "done" },
      { date: "2026-08-02", status: "missed" },
      { date: "2026-08-03", status: "in_progress" }, // today, unlogged — not a failure yet
    ]);
  });

  it("marks days before the habit's committed_date as not_tracked, not missed", () => {
    const rows = buildHabitConsistencyRows(
      [{ id: "h1", name: "New habit", committedDate: "2026-08-02" }],
      [],
      days,
      "2026-08-03"
    );
    expect(rows[0].cells).toEqual([
      { date: "2026-08-01", status: "not_tracked" },
      { date: "2026-08-02", status: "missed" },
      { date: "2026-08-03", status: "in_progress" },
    ]);
  });

  it("a completed=false log for a past day still reads as missed, not silently ignored", () => {
    const rows = buildHabitConsistencyRows(
      [{ id: "h1", name: "Habit", committedDate: "2026-08-01" }],
      [{ habitId: "h1", date: "2026-08-01", completed: false }],
      days,
      "2026-08-03"
    );
    expect(rows[0].cells[0].status).toBe("missed");
  });

  it("today reads done, not in_progress, when it's already been completed", () => {
    const rows = buildHabitConsistencyRows(
      [{ id: "h1", name: "Habit", committedDate: "2026-08-01" }],
      [{ habitId: "h1", date: "2026-08-03", completed: true }],
      days,
      "2026-08-03"
    );
    expect(rows[0].cells[2]).toEqual({ date: "2026-08-03", status: "done" });
  });

  it("09:00-local vs. just-after-midnight: today's cell flips from in_progress to missed only once the day has ended", () => {
    const habits = [{ id: "h1", name: "Habit", committedDate: "2026-08-01" }];
    const logs: { habitId: string; date: string; completed: boolean }[] = [];

    const duringTheDay = buildHabitConsistencyRows(habits, logs, days, "2026-08-03");
    expect(duringTheDay[0].cells[2]).toEqual({ date: "2026-08-03", status: "in_progress" });

    // Calendar has advanced past 08-03 — it's no longer "today", so its
    // missing log now reads as a real miss like any other past day.
    const afterMidnight = buildHabitConsistencyRows(habits, logs, days, "2026-08-04");
    expect(afterMidnight[0].cells[2]).toEqual({ date: "2026-08-03", status: "missed" });
  });
});
