import { describe, expect, it } from "vitest";
import { derivePrefillAllocation, subtractConfirmedHours } from "../prefill";
import type { AllocationWindow, TimeRange } from "../schedule";

const window: AllocationWindow = {
  start: new Date("2026-08-10T13:00:00Z"), // 08:00 CDT
  end: new Date("2026-08-10T15:00:00Z"), // 10:00 CDT
};

const NO_WORKOUT = {
  workoutLoggedToday: false,
  scheduledWorkoutTime: null,
  scheduledWorkoutDurationMinutes: null,
};

describe("derivePrefillAllocation", () => {
  it("returns all zeros when there's no data to derive from", () => {
    const result = derivePrefillAllocation(window, { lockInSessions: [], loggedPrayerTimes: [], ...NO_WORKOUT });
    expect(result).toEqual({ deen: 0, business: 0, school: 0, fitness: 0, co_op: 0 });
  });

  it("maps a fully-contained Lock-In session to business, snapped to 15", () => {
    const session: TimeRange = { start: new Date("2026-08-10T13:07:00Z"), end: new Date("2026-08-10T13:52:00Z") }; // 45 real minutes
    const result = derivePrefillAllocation(window, { lockInSessions: [session], loggedPrayerTimes: [], ...NO_WORKOUT });
    expect(result.business).toBe(45); // already a multiple of 15
  });

  it("clips a Lock-In session that only partially overlaps the window", () => {
    const session: TimeRange = { start: new Date("2026-08-10T14:30:00Z"), end: new Date("2026-08-10T15:45:00Z") }; // starts in-window, ends after
    const result = derivePrefillAllocation(window, { lockInSessions: [session], loggedPrayerTimes: [], ...NO_WORKOUT });
    expect(result.business).toBe(30); // only 14:30-15:00 (30min) is inside the window
  });

  it("counts a still-active (open-ended) Lock-In session up to the window's own end", () => {
    const session: TimeRange = { start: new Date("2026-08-10T14:00:00Z"), end: null };
    const result = derivePrefillAllocation(window, { lockInSessions: [session], loggedPrayerTimes: [], ...NO_WORKOUT });
    expect(result.business).toBe(60); // 14:00-15:00
  });

  it("snaps a Lock-In overlap down to the nearest 15, never rounding up", () => {
    const session: TimeRange = { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T13:22:00Z") }; // 22 real minutes
    const result = derivePrefillAllocation(window, { lockInSessions: [session], loggedPrayerTimes: [], ...NO_WORKOUT });
    expect(result.business).toBe(15);
  });

  // 2026-08-19 review catch: pre-fill must derive Deen from prayers actually
  // LOGGED, one nominal STEP each — never from computePrayerWindows'
  // multi-hour *validity* windows, which would massively overcount (Dhuhr's
  // window alone can run 3+ hours) and manufacture a flattering Signal:Noise
  // number out of nothing, since Deen sits on the signal side.
  it("gives one nominal STEP of deen per logged prayer whose real time falls inside the window", () => {
    const fajrTime = new Date("2026-08-10T13:15:00Z");
    const result = derivePrefillAllocation(window, { lockInSessions: [], loggedPrayerTimes: [fajrTime], ...NO_WORKOUT });
    expect(result.deen).toBe(15);
  });

  it("sums multiple logged prayers falling inside the same allocation window", () => {
    const fajrTime = new Date("2026-08-10T13:05:00Z");
    const dhuhrTime = new Date("2026-08-10T14:10:00Z");
    const result = derivePrefillAllocation(window, {
      lockInSessions: [],
      loggedPrayerTimes: [fajrTime, dhuhrTime],
      ...NO_WORKOUT,
    });
    expect(result.deen).toBe(30);
  });

  it("does not count a logged prayer whose time falls outside the window", () => {
    const outsideTime = new Date("2026-08-10T16:00:00Z");
    const result = derivePrefillAllocation(window, {
      lockInSessions: [],
      loggedPrayerTimes: [outsideTime],
      ...NO_WORKOUT,
    });
    expect(result.deen).toBe(0);
  });

  it("never scales a logged prayer's contribution by how long its window was valid for — always exactly one STEP", () => {
    // Dhuhr's real validity window can run 3+ hours; the prayer itself still
    // only ever contributes one nominal STEP, regardless.
    const dhuhrTime = new Date("2026-08-10T13:30:00Z");
    const result = derivePrefillAllocation(window, {
      lockInSessions: [],
      loggedPrayerTimes: [dhuhrTime],
      ...NO_WORKOUT,
    });
    expect(result.deen).toBe(15);
  });

  // 2026-08-19 review catch: fitness needs BOTH evidence (a workout_logs
  // row — the session actually happened) AND placement (workout_schedule's
  // time/duration — where it goes). Neither alone is enough: scheduled-but
  // -unlogged is the prayer-window mistake again (crediting a plan, not a
  // fact), and logged-but-unplaced has no window to go in without a guess.
  describe("fitness — requires both a logged workout and a scheduled placement", () => {
    it("adds a nominal fitness block when a workout is logged AND its scheduled time falls inside the window", () => {
      const result = derivePrefillAllocation(window, {
        lockInSessions: [],
        loggedPrayerTimes: [],
        workoutLoggedToday: true,
        scheduledWorkoutTime: new Date("2026-08-10T14:00:00Z"),
        scheduledWorkoutDurationMinutes: null,
      });
      expect(result.fitness).toBe(30);
    });

    it("does not add a fitness block when scheduled but never logged", () => {
      const result = derivePrefillAllocation(window, {
        lockInSessions: [],
        loggedPrayerTimes: [],
        workoutLoggedToday: false,
        scheduledWorkoutTime: new Date("2026-08-10T14:00:00Z"),
        scheduledWorkoutDurationMinutes: 45,
      });
      expect(result.fitness).toBe(0);
    });

    it("does not add a fitness block when logged but never scheduled — no window to place it in without guessing", () => {
      const result = derivePrefillAllocation(window, {
        lockInSessions: [],
        loggedPrayerTimes: [],
        workoutLoggedToday: true,
        scheduledWorkoutTime: null,
        scheduledWorkoutDurationMinutes: null,
      });
      expect(result.fitness).toBe(0);
    });

    // 2026-08-19, requested directly by Ayman: "why are we guessing instead
    // of storing it." A real duration_minutes on the schedule row must win
    // over the nominal 30 whenever the schedule actually has one.
    it("uses the real workout duration when the schedule row has one, not the nominal 30", () => {
      const result = derivePrefillAllocation(window, {
        lockInSessions: [],
        loggedPrayerTimes: [],
        workoutLoggedToday: true,
        scheduledWorkoutTime: new Date("2026-08-10T14:00:00Z"),
        scheduledWorkoutDurationMinutes: 75,
      });
      expect(result.fitness).toBe(75);
    });

    it("falls back to the nominal 30 when the schedule row has no duration set", () => {
      const result = derivePrefillAllocation(window, {
        lockInSessions: [],
        loggedPrayerTimes: [],
        workoutLoggedToday: true,
        scheduledWorkoutTime: new Date("2026-08-10T14:00:00Z"),
        scheduledWorkoutDurationMinutes: null,
      });
      expect(result.fitness).toBe(30);
    });

    it("does not add a fitness block for a scheduled+logged workout whose time falls outside the window", () => {
      const result = derivePrefillAllocation(window, {
        lockInSessions: [],
        loggedPrayerTimes: [],
        workoutLoggedToday: true,
        scheduledWorkoutTime: new Date("2026-08-10T16:00:00Z"),
        scheduledWorkoutDurationMinutes: null,
      });
      expect(result.fitness).toBe(0);
    });
  });

  it("never guesses school or co_op — always 0, since nothing logs data for them here", () => {
    const session: TimeRange = { start: window.start, end: window.end };
    const result = derivePrefillAllocation(window, { lockInSessions: [session], loggedPrayerTimes: [], ...NO_WORKOUT });
    expect(result.school).toBe(0);
    expect(result.co_op).toBe(0);
  });

  it("caps the total below the window's own length when sources overlap and would otherwise overrun it", () => {
    const session: TimeRange = { start: window.start, end: window.end };
    const result = derivePrefillAllocation(window, {
      lockInSessions: [session],
      loggedPrayerTimes: [new Date("2026-08-10T13:15:00Z")],
      workoutLoggedToday: true,
      scheduledWorkoutTime: new Date("2026-08-10T14:00:00Z"),
      scheduledWorkoutDurationMinutes: null,
    });
    const total = result.deen + result.business + result.school + result.fitness + result.co_op;
    expect(total).toBeLessThan(120);
    expect(total % 15).toBe(0);
  });

  // Re-confirmed 2026-08-19 per the Lead: the cap's guarantee is structural
  // (proportional scale-down of whatever raw sum it's given always lands at
  // or below the limit), so it holds regardless of what produced the raw
  // values — but re-verified explicitly anyway now that Deen's input
  // changed from window-overlap to logged-prayer-count, since a full
  // Lock-In session plus several logged prayers in one window is exactly
  // the combination that would have broken a less-structural cap.
  it("stays below the window's own length for a long Lock-In session plus several logged prayers plus a workout", () => {
    const fullSession: TimeRange = { start: window.start, end: window.end };
    const result = derivePrefillAllocation(window, {
      lockInSessions: [fullSession],
      loggedPrayerTimes: [
        new Date("2026-08-10T13:05:00Z"),
        new Date("2026-08-10T13:35:00Z"),
        new Date("2026-08-10T14:05:00Z"),
      ],
      workoutLoggedToday: true,
      scheduledWorkoutTime: new Date("2026-08-10T14:30:00Z"),
      scheduledWorkoutDurationMinutes: null,
    });
    const total = result.deen + result.business + result.school + result.fitness + result.co_op;
    expect(total).toBeLessThan(120);
    expect(total).toBeLessThanOrEqual(105);
    expect(total % 15).toBe(0);
  });

  it("never rubber-stamps the window at 100% — a Lock-In session spanning the entire window alone still leaves at least one STEP wasted", () => {
    // Per the Lead's ruling (2026-08-19): pre-fill must never complete the
    // window, even when the real data genuinely covers all of it, so
    // correcting the pre-fill — not just tapping Done — stays the rewarded
    // action.
    const fullWindowSession: TimeRange = { start: window.start, end: window.end };
    const result = derivePrefillAllocation(window, {
      lockInSessions: [fullWindowSession],
      loggedPrayerTimes: [],
      ...NO_WORKOUT,
    });
    const total = result.deen + result.business + result.school + result.fitness + result.co_op;
    expect(total).toBe(105); // 120 - one STEP reserved as wasted
    expect(result.business).toBe(105);
  });

  it("leaves a within-bounds allocation untouched by the cap", () => {
    const session: TimeRange = { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T13:30:00Z") };
    const result = derivePrefillAllocation(window, { lockInSessions: [session], loggedPrayerTimes: [], ...NO_WORKOUT });
    expect(result.business).toBe(30);
  });
});

// 2026-08-19: hourly Lock-In confirms — the double-count guard. Per-hour,
// not per-window (a session can be partially covered by confirmed hours
// with the remainder still eligible for the coarse overlap credit; see
// schedule.ts's isWindowCoveredBySessionHours for the window-level UX
// shortcut on top of this).
describe("subtractConfirmedHours", () => {
  it("removes a confirmed hour from the middle of a longer session, leaving the rest", () => {
    // Session 1pm-4pm; hours 1-2pm and 2-3pm explicitly confirmed.
    const session: TimeRange = { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T16:00:00Z") };
    const confirmed: TimeRange[] = [
      { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T14:00:00Z") },
      { start: new Date("2026-08-10T14:00:00Z"), end: new Date("2026-08-10T15:00:00Z") },
    ];
    const result = subtractConfirmedHours([session], confirmed);
    expect(result).toEqual([{ start: new Date("2026-08-10T15:00:00Z"), end: new Date("2026-08-10T16:00:00Z") }]);
  });

  it("splits a session into two remaining pieces when a confirmed hour falls in the middle", () => {
    const session: TimeRange = { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T16:00:00Z") };
    const confirmed: TimeRange[] = [{ start: new Date("2026-08-10T14:00:00Z"), end: new Date("2026-08-10T15:00:00Z") }];
    const result = subtractConfirmedHours([session], confirmed);
    expect(result).toEqual([
      { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T14:00:00Z") },
      { start: new Date("2026-08-10T15:00:00Z"), end: new Date("2026-08-10T16:00:00Z") },
    ]);
  });

  it("returns the session unchanged when no hours are confirmed", () => {
    const session: TimeRange = { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T15:00:00Z") };
    expect(subtractConfirmedHours([session], [])).toEqual([session]);
  });

  it("returns nothing when the confirmed hours fully cover the session", () => {
    const session: TimeRange = { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T15:00:00Z") };
    const confirmed: TimeRange[] = [{ start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T15:00:00Z") }];
    expect(subtractConfirmedHours([session], confirmed)).toEqual([]);
  });

  it("handles a still-active (open-ended) session, keeping it open past the last confirmed hour", () => {
    const session: TimeRange = { start: new Date("2026-08-10T13:00:00Z"), end: null };
    const confirmed: TimeRange[] = [{ start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T14:00:00Z") }];
    const result = subtractConfirmedHours([session], confirmed);
    expect(result).toEqual([{ start: new Date("2026-08-10T14:00:00Z"), end: null }]);
  });

  it("leaves a session untouched when the confirmed hour doesn't overlap it at all", () => {
    const session: TimeRange = { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T14:00:00Z") };
    const confirmed: TimeRange[] = [{ start: new Date("2026-08-10T16:00:00Z"), end: new Date("2026-08-10T17:00:00Z") }];
    expect(subtractConfirmedHours([session], confirmed)).toEqual([session]);
  });

  it("processes multiple sessions independently", () => {
    const sessionA: TimeRange = { start: new Date("2026-08-10T09:00:00Z"), end: new Date("2026-08-10T10:00:00Z") };
    const sessionB: TimeRange = { start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T15:00:00Z") };
    const confirmed: TimeRange[] = [{ start: new Date("2026-08-10T13:00:00Z"), end: new Date("2026-08-10T14:00:00Z") }];
    const result = subtractConfirmedHours([sessionA, sessionB], confirmed);
    expect(result).toEqual([sessionA, { start: new Date("2026-08-10T14:00:00Z"), end: new Date("2026-08-10T15:00:00Z") }]);
  });

  // The actual scenario from the design discussion: a "No" at 3pm-4pm must
  // not also be coarse-credited as business via the session-overlap
  // pre-fill for a 2h window straddling it.
  it("end to end: a declined hour inside a still-active session is excluded from that window's business overlap credit", () => {
    const window: AllocationWindow = {
      start: new Date("2026-08-10T15:00:00Z"),
      end: new Date("2026-08-10T17:00:00Z"),
    };
    const session: TimeRange = { start: new Date("2026-08-10T13:00:00Z"), end: null }; // still active
    const declinedHour: TimeRange = { start: new Date("2026-08-10T15:00:00Z"), end: new Date("2026-08-10T16:00:00Z") };

    const adjustedSessions = subtractConfirmedHours([session], [declinedHour]);
    const result = derivePrefillAllocation(window, {
      lockInSessions: adjustedSessions,
      loggedPrayerTimes: [],
      workoutLoggedToday: false,
      scheduledWorkoutTime: null,
      scheduledWorkoutDurationMinutes: null,
    });
    // Without the subtraction this would be 120 (full window inside the
    // open session); with it, only the still-open 16:00-17:00 portion
    // counts toward the coarse credit.
    expect(result.business).toBe(60);
  });
});
