import { describe, expect, it } from "vitest";
import {
  DAILY,
  buildFrequencyCells,
  computeAdherence,
  computeDueState,
  computeFrequencyStreak,
  describeFrequency,
  expectedRatePerDay,
  frequencyFromColumns,
  frequencyToColumns,
  normalizeFrequency,
  streakLabel,
  FrequencyError,
  type HabitFrequency,
} from "../frequency";

// 2026-10-05 is a Monday. Weeks are Sun–Sat, so that week is 10-04 .. 10-10.
const MON = "2026-10-05";

describe("normalizeFrequency", () => {
  it("defaults to daily for nothing / explicit daily", () => {
    expect(normalizeFrequency(undefined)).toEqual(DAILY);
    expect(normalizeFrequency(null)).toEqual(DAILY);
    expect(normalizeFrequency({ kind: "daily" })).toEqual(DAILY);
  });
  it("sorts and dedupes weekdays, and 'all seven days' collapses to daily", () => {
    expect(normalizeFrequency({ kind: "weekdays", days: [5, 1, 3, 1] })).toEqual({ kind: "weekdays", days: [1, 3, 5] });
    expect(normalizeFrequency({ kind: "weekdays", days: [0, 1, 2, 3, 4, 5, 6] })).toEqual(DAILY);
  });
  it("rejects out-of-range or malformed input with a FrequencyError", () => {
    for (const bad of [
      { kind: "weekdays", days: [] },
      { kind: "weekdays", days: [7] },
      { kind: "per_week", count: 0 },
      { kind: "per_week", count: 7 }, // 7 a week is daily
      { kind: "per_month", count: 29 },
      { kind: "every_n_days", interval: 1 }, // 1 day is daily
      { kind: "every_n_days", interval: 366 },
      { kind: "per_week", count: 2.5 },
      { kind: "sometimes" },
      "daily",
    ]) {
      expect(() => normalizeFrequency(bad), JSON.stringify(bad)).toThrow(FrequencyError);
    }
  });
  it("accepts numeric strings (form inputs)", () => {
    expect(normalizeFrequency({ kind: "per_week", count: "3" })).toEqual({ kind: "per_week", count: 3 });
  });
});

describe("columns round trip", () => {
  const cases: HabitFrequency[] = [DAILY, { kind: "weekdays", days: [1, 3, 5] }, { kind: "per_week", count: 3 }, { kind: "per_month", count: 2 }, { kind: "every_n_days", interval: 14 }];
  it.each(cases)("%j survives value -> columns -> value", (f) => {
    expect(frequencyFromColumns(frequencyToColumns(f))).toEqual(f);
  });
  it("a row from before the migration (no columns) or a garbage row reads as daily, never throws", () => {
    expect(frequencyFromColumns({})).toEqual(DAILY);
    expect(frequencyFromColumns(null)).toEqual(DAILY);
    expect(frequencyFromColumns({ frequency_type: "per_week", frequency_count: null })).toEqual(DAILY);
    expect(frequencyFromColumns({ frequency_type: "weekdays", frequency_days: [] })).toEqual(DAILY);
  });
  it("only the columns that belong to a kind are set (the DB CHECKs rely on this)", () => {
    expect(frequencyToColumns({ kind: "per_week", count: 3 })).toEqual({ frequency_type: "per_week", frequency_count: 3, frequency_days: null, frequency_interval: null });
    expect(frequencyToColumns(DAILY)).toEqual({ frequency_type: "daily", frequency_count: null, frequency_days: null, frequency_interval: null });
  });
});

describe("describeFrequency / expectedRatePerDay", () => {
  it("labels", () => {
    expect(describeFrequency(DAILY)).toBe("Every day");
    expect(describeFrequency({ kind: "weekdays", days: [1, 3, 5] })).toBe("Mon · Wed · Fri");
    expect(describeFrequency({ kind: "weekdays", days: [1, 2, 3, 4, 5] })).toBe("Weekdays");
    expect(describeFrequency({ kind: "weekdays", days: [0, 6] })).toBe("Weekends");
    expect(describeFrequency({ kind: "per_week", count: 1 })).toBe("Once a week");
    expect(describeFrequency({ kind: "per_week", count: 3 })).toBe("3× a week");
    expect(describeFrequency({ kind: "per_month", count: 2 })).toBe("Twice a month");
    expect(describeFrequency({ kind: "every_n_days", interval: 3 })).toBe("Every 3 days");
    expect(describeFrequency({ kind: "every_n_days", interval: 7 })).toBe("Every week");
    expect(describeFrequency({ kind: "every_n_days", interval: 14 })).toBe("Every 2 weeks");
  });
  it("expected rate per day", () => {
    expect(expectedRatePerDay(DAILY)).toBe(1);
    expect(expectedRatePerDay({ kind: "weekdays", days: [1, 3, 5] })).toBeCloseTo(3 / 7);
    expect(expectedRatePerDay({ kind: "per_week", count: 1 })).toBeCloseTo(1 / 7);
    expect(expectedRatePerDay({ kind: "per_month", count: 1 })).toBeCloseTo(1 / 30.4375);
    expect(expectedRatePerDay({ kind: "every_n_days", interval: 4 })).toBe(0.25);
  });
});

describe("computeDueState", () => {
  const ctx = (completedDates: string[], committedDate = "2026-01-01") => ({ completedDates, committedDate });

  it("daily is always due", () => {
    expect(computeDueState(DAILY, MON, ctx([])).due).toBe(true);
  });

  it("weekdays: due only on its days, shows 'Next: …' otherwise, and a done off-day still shows ticked", () => {
    const f: HabitFrequency = { kind: "weekdays", days: [1, 3, 5] }; // Mon Wed Fri
    expect(computeDueState(f, MON, ctx([])).due).toBe(true); // Monday
    const tue = computeDueState(f, "2026-10-06", ctx([]));
    expect(tue.due).toBe(false);
    expect(tue.statusText).toBe("Next: Wed");
    expect(computeDueState(f, "2026-10-06", ctx(["2026-10-06"])).due).toBe(true); // done on an off day: still visible, ticked
    expect(computeDueState(f, "2026-10-09", ctx([])).statusText).toBeNull(); // Friday: due, no status
    expect(computeDueState(f, "2026-10-10", ctx([])).statusText).toBe("Next: Mon"); // Saturday wraps to Monday
  });

  it("per_week: due until the Sun–Sat quota is met, progress counts only this week", () => {
    const f: HabitFrequency = { kind: "per_week", count: 3 };
    const s = computeDueState(f, "2026-10-07", ctx(["2026-10-03" /* last week */, "2026-10-05"]));
    expect(s.progress).toEqual({ done: 1, target: 3, unit: "week" });
    expect(s.due).toBe(true);
    expect(s.statusText).toBe("1 of 3 this week");
    const met = computeDueState(f, "2026-10-08", ctx(["2026-10-05", "2026-10-06", "2026-10-07"]));
    expect(met.due).toBe(false);
    expect(met.statusText).toBe("Done for this week");
    // met earlier today by tapping it: still shown so it can be un-ticked
    expect(computeDueState(f, "2026-10-07", ctx(["2026-10-05", "2026-10-06", "2026-10-07"])).due).toBe(true);
  });

  it("per_week: a week rollover resets the count (Saturday met, Sunday fresh)", () => {
    const f: HabitFrequency = { kind: "per_week", count: 1 };
    expect(computeDueState(f, "2026-10-10", ctx(["2026-10-06"])).due).toBe(false);
    expect(computeDueState(f, "2026-10-11", ctx(["2026-10-06"])).due).toBe(true);
  });

  it("per_month: counts within the calendar month only", () => {
    const f: HabitFrequency = { kind: "per_month", count: 2 };
    const s = computeDueState(f, "2026-10-20", ctx(["2026-09-30", "2026-10-02"]));
    expect(s.progress).toEqual({ done: 1, target: 2, unit: "month" });
    expect(computeDueState(f, "2026-10-20", ctx(["2026-10-02", "2026-10-09"])).due).toBe(false);
  });

  it("a habit committed late in a period only owes what it can still do (first partial week)", () => {
    const f: HabitFrequency = { kind: "per_week", count: 5 };
    // committed Friday 10-09: only Fri+Sat left in that week -> target 2, not 5
    expect(computeDueState(f, "2026-10-09", ctx([], "2026-10-09")).progress).toEqual({ done: 0, target: 2, unit: "week" });
    // committed Sunday: the full week is available
    expect(computeDueState(f, "2026-10-05", ctx([], "2026-10-04")).progress?.target).toBe(5);
  });

  it("every_n_days: due once N days have passed since the LAST completion", () => {
    const f: HabitFrequency = { kind: "every_n_days", interval: 3 };
    expect(computeDueState(f, "2026-10-07", ctx(["2026-10-05"])).due).toBe(false); // 2 days
    expect(computeDueState(f, "2026-10-07", ctx(["2026-10-05"])).statusText).toBe("Due tomorrow");
    expect(computeDueState(f, "2026-10-08", ctx(["2026-10-05"])).due).toBe(true); // exactly 3 days
    expect(computeDueState(f, "2026-10-08", ctx(["2026-10-05"])).nextDueDate).toBe("2026-10-08");
    expect(computeDueState(f, "2026-10-12", ctx(["2026-10-05"])).due).toBe(true); // overdue stays due
    expect(computeDueState(f, "2026-10-05", ctx([], "2026-10-05")).due).toBe(true); // never done: due from its start
  });
});

describe("computeFrequencyStreak", () => {
  it("daily matches the original walk-back (an unticked today does not break it)", () => {
    expect(computeFrequencyStreak(DAILY, ["2026-10-02", "2026-10-03", "2026-10-04"], MON, "2026-01-01")).toEqual({ count: 3, unit: "day" });
    expect(computeFrequencyStreak(DAILY, ["2026-10-02", "2026-10-04", MON], MON, "2026-01-01").count).toBe(2); // gap on 10-03
    expect(computeFrequencyStreak(DAILY, [], MON, "2026-01-01").count).toBe(0);
  });

  it("weekdays: days off neither add nor break; a missed scheduled day resets", () => {
    const f: HabitFrequency = { kind: "weekdays", days: [1, 3, 5] };
    // Mon 9-28, Wed 9-30, Fri 10-02 all done; Mon 10-05 (today) not yet -> run of 3, not broken by today
    expect(computeFrequencyStreak(f, ["2026-09-28", "2026-09-30", "2026-10-02"], MON, "2026-01-01")).toEqual({ count: 3, unit: "in_a_row" });
    // today's Monday done too
    expect(computeFrequencyStreak(f, ["2026-09-28", "2026-09-30", "2026-10-02", MON], MON, "2026-01-01").count).toBe(4);
    // Wed 9-30 missed -> only Fri 10-02 counts
    expect(computeFrequencyStreak(f, ["2026-09-28", "2026-10-02"], MON, "2026-01-01").count).toBe(1);
  });

  it("per_week: consecutive weeks that met the quota; the open week counts only once met", () => {
    const f: HabitFrequency = { kind: "per_week", count: 2 };
    const done = ["2026-09-21", "2026-09-22", "2026-09-28", "2026-09-29"]; // two prior weeks met (Sun 9-20 and Sun 9-27 weeks)
    expect(computeFrequencyStreak(f, done, MON, "2026-01-01")).toEqual({ count: 2, unit: "week" }); // this week 0/2 yet: not over, not counted
    expect(computeFrequencyStreak(f, [...done, "2026-10-04", MON], MON, "2026-01-01").count).toBe(3); // this week now met
    expect(computeFrequencyStreak(f, ["2026-09-21", "2026-09-29", "2026-09-30"], MON, "2026-01-01").count).toBe(1); // week of 9-20 only 1/2 -> chain stops there
  });

  it("per_month: consecutive months meeting the quota", () => {
    const f: HabitFrequency = { kind: "per_month", count: 1 };
    expect(computeFrequencyStreak(f, ["2026-08-15", "2026-09-10"], MON, "2026-01-01")).toEqual({ count: 2, unit: "month" });
    expect(computeFrequencyStreak(f, ["2026-07-15", "2026-09-10"], MON, "2026-01-01").count).toBe(1); // August missed
  });

  it("never counts periods from before the habit existed", () => {
    const f: HabitFrequency = { kind: "per_week", count: 1 };
    expect(computeFrequencyStreak(f, ["2026-10-05"], MON, "2026-10-05").count).toBe(1);
  });

  it("every_n_days: a chain of completions each within N days; dies once the gap is exceeded", () => {
    const f: HabitFrequency = { kind: "every_n_days", interval: 7 };
    expect(computeFrequencyStreak(f, ["2026-09-14", "2026-09-21", "2026-09-28"], MON, "2026-01-01")).toEqual({ count: 3, unit: "in_a_row" });
    expect(computeFrequencyStreak(f, ["2026-09-07", "2026-09-28"], MON, "2026-01-01").count).toBe(1); // 21-day gap breaks the chain
    expect(computeFrequencyStreak(f, ["2026-09-14"], MON, "2026-01-01").count).toBe(0); // 21 days ago, more than 7: not alive
  });

  it("labels", () => {
    expect(streakLabel({ count: 5, unit: "day" })).toBe("5d streak");
    expect(streakLabel({ count: 3, unit: "week" })).toBe("3 wk streak");
    expect(streakLabel({ count: 2, unit: "month" })).toBe("2 mo streak");
    expect(streakLabel({ count: 4, unit: "in_a_row" })).toBe("4 in a row");
    expect(streakLabel({ count: 0, unit: "day" })).toBe("");
  });
});

describe("computeAdherence", () => {
  const start = "2026-09-06"; // 30 days ending today (inclusive of 10-05)

  it("daily reproduces the original rolling rate: today never hurts, only helps", () => {
    expect(computeAdherence(DAILY, ["2026-10-03", "2026-10-04"], "2026-10-01", MON, "2026-01-01")).toEqual({ done: 2, total: 4, unit: "day" }); // 10-01..10-04
    expect(computeAdherence(DAILY, ["2026-10-03", "2026-10-04", MON], "2026-10-01", MON, "2026-01-01")).toEqual({ done: 3, total: 5, unit: "day" });
  });

  it("daily is floored at the committed date", () => {
    expect(computeAdherence(DAILY, [], "2026-10-01", MON, "2026-10-03")).toEqual({ done: 0, total: 2, unit: "day" });
  });

  it("weekdays only counts scheduled days", () => {
    const f: HabitFrequency = { kind: "weekdays", days: [1, 3, 5] };
    // 10-01 Thu .. 10-04 Sun: only Fri 10-02 is scheduled
    expect(computeAdherence(f, ["2026-10-02"], "2026-10-01", MON, "2026-01-01")).toEqual({ done: 1, total: 1, unit: "day" });
    // plus today (Mon, scheduled) done
    expect(computeAdherence(f, ["2026-10-02", MON], "2026-10-01", MON, "2026-01-01")).toEqual({ done: 2, total: 2, unit: "day" });
    // an extra completion on an OFF day doesn't inflate the numerator
    expect(computeAdherence(f, ["2026-10-03"], "2026-10-01", MON, "2026-01-01")).toEqual({ done: 0, total: 1, unit: "day" });
  });

  it("per_week: weeks that met their quota out of weeks that ended; the open week only helps", () => {
    const f: HabitFrequency = { kind: "per_week", count: 2 };
    const done = ["2026-09-21", "2026-09-22", /* week of 9-20 met */ "2026-09-29" /* week of 9-27 not met: 1/2 */];
    const r = computeAdherence(f, done, start, MON, "2026-01-01");
    expect(r.unit).toBe("week");
    // weeks (Sun-start): 9-06, 9-13, 9-20, 9-27 ended; 10-04 open (0/2, excluded)
    expect(r).toEqual({ done: 1, total: 4, unit: "week" });
    const withOpenMet = computeAdherence(f, [...done, "2026-10-04", MON], start, MON, "2026-01-01");
    expect(withOpenMet).toEqual({ done: 2, total: 5, unit: "week" });
  });

  it("per_month and every_n_days produce sensible, bounded numbers", () => {
    expect(computeAdherence({ kind: "per_month", count: 1 }, ["2026-08-20"], "2026-08-10", MON, "2026-01-01")).toEqual({ done: 1, total: 2, unit: "month" }); // Aug met; Sep ended unmet; Oct open unmet
    const every = computeAdherence({ kind: "every_n_days", interval: 7 }, ["2026-09-14", "2026-09-21", "2026-09-28"], start, MON, "2026-01-01");
    expect(every.unit).toBe("completion");
    expect(every.done).toBe(3);
    expect(every.total).toBe(4); // floor(29 days / 7)
    // never reported above 100%
    expect(computeAdherence({ kind: "every_n_days", interval: 30 }, ["2026-09-10", "2026-09-20"], start, MON, "2026-01-01").total).toBe(2);
  });
});

describe("buildFrequencyCells", () => {
  const days = ["2026-10-02", "2026-10-03", "2026-10-04", MON];
  it("daily: missed in the past, in_progress today", () => {
    expect(buildFrequencyCells(DAILY, ["2026-10-03"], days, MON, "2026-01-01").map((c) => c.status)).toEqual(["missed", "done", "missed", "in_progress"]);
  });
  it("weekdays: unscheduled days are off_day, not missed", () => {
    const f: HabitFrequency = { kind: "weekdays", days: [1, 3, 5] };
    expect(buildFrequencyCells(f, [], days, MON, "2026-01-01").map((c) => c.status)).toEqual(["missed", "off_day", "off_day", "in_progress"]);
  });
  it("flexible habits never paint a day red: done or neutral open", () => {
    expect(buildFrequencyCells({ kind: "per_week", count: 3 }, ["2026-10-03"], days, MON, "2026-01-01").map((c) => c.status)).toEqual(["open", "done", "open", "open"]);
  });
  it("days before the habit existed are not_tracked", () => {
    expect(buildFrequencyCells(DAILY, [], days, MON, "2026-10-04").map((c) => c.status)).toEqual(["not_tracked", "not_tracked", "missed", "in_progress"]);
  });
});
