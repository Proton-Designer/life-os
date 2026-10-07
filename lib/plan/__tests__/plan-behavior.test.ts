import { describe, expect, it } from "vitest";
import { formatClockSeconds, formatDuration, isPlanArea, orderPlanItems, planTimerState, remainingGoalMinutes, startBehavior, timerReadout } from "../plan-behavior";

const T = (startTime: string | null, durationMinutes: number | null) => ({ startTime, durationMinutes });

describe("startBehavior", () => {
  it("Business: a timer starts a timed Deep Work session", () => {
    expect(startBehavior("business", T(null, 90))).toEqual({ kind: "deep_work", goalMinutes: 90 });
    expect(startBehavior("business", T("09:00", 45))).toEqual({ kind: "deep_work", goalMinutes: 45 });
  });
  it("Business: only a start time starts an elapsed Deep Work session (no goal)", () => {
    expect(startBehavior("business", T("09:00", null))).toEqual({ kind: "deep_work", goalMinutes: null });
  });
  it("School always starts Deep Study, timed only when a timer was set", () => {
    expect(startBehavior("school", T(null, null))).toEqual({ kind: "complete_only" });
    expect(startBehavior("school", T("14:00", null))).toEqual({ kind: "deep_study", goalMinutes: null });
    expect(startBehavior("school", T(null, 120))).toEqual({ kind: "deep_study", goalMinutes: 120 });
  });
  it("any other domain, or none, with timing gets an inline timer", () => {
    for (const area of [null, "work", "body", "faith", "learning", "personal_growth"]) {
      expect(startBehavior(area, T(null, 30))).toEqual({ kind: "inline_timer", goalMinutes: 30 });
      expect(startBehavior(area, T("07:00", null))).toEqual({ kind: "inline_timer", goalMinutes: null });
    }
  });
  it("a Business or other task with no timing is Complete-only", () => {
    for (const area of [null, "business", "work", "body"]) expect(startBehavior(area, T(null, null))).toEqual({ kind: "complete_only" });
  });
});

describe("orderPlanItems", () => {
  const item = (id: string, startTime: string | null, planOrder: number | null = null, mitRank: number | null = null) => ({ id, startTime, planOrder, mitRank });
  it("timed lines first by clock time, untimed after", () => {
    const out = orderPlanItems([item("c", null), item("b", "09:00"), item("a", "05:00")]);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
  it("ties fall to manual order, then rank (crown first)", () => {
    expect(orderPlanItems([item("x", null, 2), item("y", null, 1)]).map((i) => i.id)).toEqual(["y", "x"]);
    expect(orderPlanItems([item("x", null, null, 2), item("y", null, null, 1)]).map((i) => i.id)).toEqual(["y", "x"]);
    expect(orderPlanItems([item("none", null), item("one", null, 0)]).map((i) => i.id)).toEqual(["one", "none"]);
  });
  it("does not mutate its input", () => {
    const input = [item("b", "09:00"), item("a", "05:00")];
    orderPlanItems(input);
    expect(input.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("timerReadout / formatting", () => {
  it("counts down, clamping at zero and flagging done", () => {
    expect(timerReadout(0, 1, 30_000)).toEqual({ seconds: 30, mode: "down", done: false });
    expect(timerReadout(0, 1, 90_000)).toEqual({ seconds: 0, mode: "down", done: true });
  });
  it("counts up when there is no duration, never negative", () => {
    expect(timerReadout(10_000, null, 75_000)).toEqual({ seconds: 65, mode: "up", done: false });
    expect(timerReadout(10_000, null, 5_000).seconds).toBe(0);
  });
  it("formats", () => {
    expect(formatClockSeconds(65)).toBe("1:05");
    expect(formatClockSeconds(3909)).toBe("1:05:09");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(isPlanArea("body")).toBe(true);
    expect(isPlanArea("co_op")).toBe(false);
  });

describe("orderPlanItems: the crown leads", () => {
  it("puts the crowned task first even when others are timed earlier or manually ordered above it", () => {
    const out = orderPlanItems([
      { id: "a", startTime: "05:00", planOrder: 0, mitRank: null },
      { id: "b", startTime: null, planOrder: 1, mitRank: null },
      { id: "c", startTime: null, planOrder: 2, mitRank: 1 },
      { id: "d", startTime: "04:00", planOrder: 3, mitRank: 2 },
    ]);
    expect(out.map((x) => x.id)).toEqual(["c", "d", "a", "b"]);
  });
});
});

describe("timerReadout with banked seconds (Pause / Resume)", () => {
  it("a resumed countdown continues from the banked time, not from zero", () => {
    // 30-minute timer, 10 minutes banked, resumed 2 minutes ago: 18 minutes left
    expect(timerReadout(0, 30, 120_000, 600)).toEqual({ seconds: 1080, mode: "down", done: false });
    // the SAME segment without the bank would claim 28 minutes: the bug this prevents
    expect(timerReadout(0, 30, 120_000, 0).seconds).toBe(1680);
  });
  it("a resumed count-up continues from the banked time", () => {
    expect(timerReadout(0, null, 120_000, 600)).toEqual({ seconds: 720, mode: "up", done: false });
  });
  it("a paused timer (not running: null start) is frozen at what was banked, whatever the clock says", () => {
    expect(timerReadout(null, 30, 9_999_999, 724)).toEqual({ seconds: 1076, mode: "down", done: false });
    expect(timerReadout(null, null, 9_999_999, 1390)).toEqual({ seconds: 1390, mode: "up", done: false });
  });
  it("banked time past the goal reads Time's up (down) and never negative", () => {
    expect(timerReadout(null, 10, 0, 700)).toEqual({ seconds: 0, mode: "down", done: true });
    expect(timerReadout(null, 10, 0, -5).seconds).toBe(600); // a corrupt negative bank is treated as nothing banked
  });
  it("is backwards compatible: no banked argument behaves as before", () => {
    expect(timerReadout(0, 1, 30_000)).toEqual({ seconds: 30, mode: "down", done: false });
  });
});

describe("planTimerState", () => {
  const item = (over: Partial<{ id: string; timerStartedAt: string | null; timerElapsedSeconds: number; completed: boolean }> = {}) => ({ id: "t1", timerStartedAt: null, timerElapsedSeconds: 0, completed: false, ...over });
  it("idle: nothing running, nothing banked", () => expect(planTimerState(item())).toBe("idle"));
  it("running-inline: an inline timer is running (with or without time already banked)", () => {
    expect(planTimerState(item({ timerStartedAt: "2026-10-07T15:00:00Z" }))).toBe("running-inline");
    expect(planTimerState(item({ timerStartedAt: "2026-10-07T15:00:00Z", timerElapsedSeconds: 300 }))).toBe("running-inline");
  });
  it("running-session: an active session belongs to THIS line (another line's session does not count)", () => {
    expect(planTimerState(item(), "t1")).toBe("running-session");
    expect(planTimerState(item(), "other")).toBe("idle");
    expect(planTimerState(item({ timerElapsedSeconds: 600 }), "t1")).toBe("running-session"); // resumed as a session, with time banked
  });
  it("paused: nothing running but time banked, and not completed", () => {
    expect(planTimerState(item({ timerElapsedSeconds: 724 }))).toBe("paused");
  });
  it("a completed line is idle whatever is banked or running", () => {
    expect(planTimerState(item({ completed: true, timerElapsedSeconds: 724 }))).toBe("idle");
    expect(planTimerState(item({ completed: true, timerStartedAt: "2026-10-07T15:00:00Z" }), "t1")).toBe("idle");
  });
});

describe("remainingGoalMinutes (the goal of a RESUMED session)", () => {
  it("duration minus the banked time, rounded UP to a whole minute", () => {
    expect(remainingGoalMinutes(30, 600)).toBe(20);
    expect(remainingGoalMinutes(30, 601)).toBe(20); // 19m59s left -> 20
    expect(remainingGoalMinutes(30, 1740)).toBe(1);
  });
  it("null when there is no timer, or nothing is left (the session then runs open-ended)", () => {
    expect(remainingGoalMinutes(null, 600)).toBeNull();
    expect(remainingGoalMinutes(30, 1800)).toBeNull();
    expect(remainingGoalMinutes(30, 99999)).toBeNull();
  });
});

