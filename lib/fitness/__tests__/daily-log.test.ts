import { describe, expect, it } from "vitest";
import { buildDailyLog, isDailyLogItemComplete, pendingDailyLog, type DailyLogInputs } from "../daily-log";

const EMPTY_INPUTS: DailyLogInputs = {
  microTotals: [],
  microFreqs: [],
  sessions: [],
  dailyChecks: [],
  bodyMetrics: [],
  benchmark: null,
};

describe("buildDailyLog", () => {
  it("empty inputs produce an empty list", () => {
    expect(buildDailyLog(EMPTY_INPUTS)).toEqual([]);
  });

  it("maps each archetype into its DailyLogItem shape", () => {
    const items = buildDailyLog({
      microTotals: [{ exerciseId: "e1", name: "Pull-ups", target: 30, loggedToday: 12, notes: null }],
      microFreqs: [{ exerciseId: "e2", name: "Farmer carry", target: 3, boutsToday: 1, notes: "grip work" }],
      sessions: [{ sessionId: "s1", name: "Push Day", durationMinutes: 45, startTime: "07:00", confirmedToday: false }],
      dailyChecks: [{ checkKind: "protein", done: false }],
      bodyMetrics: [{ metric: "weight", lastValue: 180, lastDate: "2026-08-19", dueToday: true }],
      benchmark: { cycleNumber: 2, dueBy: "2026-08-25" },
    });

    expect(items).toEqual([
      { kind: "micro_total", exerciseId: "e1", name: "Pull-ups", logged: 12, target: 30, notes: null },
      { kind: "micro_freq", exerciseId: "e2", name: "Farmer carry", bouts: 1, target: 3, notes: "grip work" },
      { kind: "session", sessionId: "s1", name: "Push Day", durationMinutes: 45, startTime: "07:00", confirmed: false },
      { kind: "daily_check", checkKind: "protein", done: false },
      { kind: "body_metric", metric: "weight", lastValue: 180, lastDate: "2026-08-19" },
      { kind: "benchmark", cycleNumber: 2, dueBy: "2026-08-25" },
    ]);
  });

  it("a body metric not due today is excluded entirely", () => {
    const items = buildDailyLog({
      ...EMPTY_INPUTS,
      bodyMetrics: [{ metric: "waist", lastValue: 34, lastDate: "2026-08-10", dueToday: false }],
    });
    expect(items).toEqual([]);
  });

  it("adversarial: NaN/negative loggedToday and target sanitize to 0, never negative or NaN", () => {
    const items = buildDailyLog({
      ...EMPTY_INPUTS,
      microTotals: [{ exerciseId: "e1", name: "X", target: NaN, loggedToday: -5, notes: null }],
    });
    expect(items).toEqual([{ kind: "micro_total", exerciseId: "e1", name: "X", logged: 0, target: 0, notes: null }]);
  });

  it("adversarial: undefined arrays on the inputs object never crash", () => {
    // @ts-expect-error hostile partial input
    expect(() => buildDailyLog({})).not.toThrow();
    // @ts-expect-error hostile partial input
    expect(buildDailyLog({})).toEqual([]);
  });
});

describe("isDailyLogItemComplete / pendingDailyLog", () => {
  it("micro_total completes once logged >= target", () => {
    expect(isDailyLogItemComplete({ kind: "micro_total", exerciseId: "e", name: "n", logged: 30, target: 30, notes: null })).toBe(true);
    expect(isDailyLogItemComplete({ kind: "micro_total", exerciseId: "e", name: "n", logged: 29, target: 30, notes: null })).toBe(false);
  });

  it("a zero/negative target is never satisfiable (sanitized to 0 upstream, but defensive here too)", () => {
    expect(isDailyLogItemComplete({ kind: "micro_total", exerciseId: "e", name: "n", logged: 5, target: 0, notes: null })).toBe(false);
  });

  it("micro_freq completes once bouts >= target", () => {
    expect(isDailyLogItemComplete({ kind: "micro_freq", exerciseId: "e", name: "n", bouts: 3, target: 3, notes: null })).toBe(true);
  });

  it("session completes only when confirmed", () => {
    expect(
      isDailyLogItemComplete({ kind: "session", sessionId: "s", name: "n", durationMinutes: 10, startTime: null, confirmed: true })
    ).toBe(true);
  });

  it("daily_check completes when done", () => {
    expect(isDailyLogItemComplete({ kind: "daily_check", checkKind: "steps", done: true })).toBe(true);
  });

  it("body_metric and benchmark are never 'complete' — presence itself is the pending state", () => {
    expect(isDailyLogItemComplete({ kind: "body_metric", metric: "weight", lastValue: null, lastDate: null })).toBe(false);
    expect(isDailyLogItemComplete({ kind: "benchmark", cycleNumber: 1, dueBy: "2026-08-25" })).toBe(false);
  });

  it("pendingDailyLog filters out exactly the completed items, preserving order of the rest", () => {
    const items = buildDailyLog({
      microTotals: [{ exerciseId: "e1", name: "Done", target: 10, loggedToday: 10, notes: null }],
      microFreqs: [{ exerciseId: "e2", name: "Not done", target: 3, boutsToday: 1, notes: null }],
      sessions: [{ sessionId: "s1", name: "Confirmed", durationMinutes: 10, startTime: null, confirmedToday: true }],
      dailyChecks: [{ checkKind: "protein", done: false }],
      bodyMetrics: [],
      benchmark: null,
    });
    const labels = pendingDailyLog(items).map((i) => {
      if (i.kind === "daily_check") return i.checkKind;
      if (i.kind === "micro_freq") return i.name;
      throw new Error(`unexpected kind in this test: ${i.kind}`);
    });
    expect(labels).toEqual(["Not done", "protein"]);
  });
});
