import { describe, expect, it } from "vitest";
import { getPendingAllocationQueue, type AllocationQueueDataSource } from "../get-allocation-queue";
import type { TimeRange } from "../schedule";

function baseDataSource(overrides: Partial<AllocationQueueDataSource> = {}): AllocationQueueDataSource {
  return {
    getProfile: async () => ({
      timezone: "America/Chicago",
      checkin_window_start: "08:00",
      checkin_window_end: "22:00",
      location_lat: null,
      location_lng: null,
      prayer_calc_method: "ISNA",
      asr_madhab: "standard",
    }),
    getWorkSessions: async () => [],
    getWorkoutSchedule: async () => null,
    getAnsweredWindowStarts: async () => [],
    getLoggedPrayerNames: async () => [],
    getWorkoutLoggedToday: async () => false,
    getSessionsForHourResolution: async () => [],
    getStoredSessionHours: async () => [],
    ...overrides,
  };
}

describe("getPendingAllocationQueue", () => {
  it("returns an empty queue when the profile can't be found", async () => {
    const result = await getPendingAllocationQueue(
      "user-1",
      new Date("2026-08-19T18:00:00Z"),
      baseDataSource({ getProfile: async () => null })
    );
    expect(result).toEqual({ items: [], unknownCount: 0, timezone: "UTC", mostRecentUnanswered: null });
  });

  it("surfaces a fired, unanswered window as a pending item with a prefill derived from real data", async () => {
    // 08:00-10:00 CDT window (fires 15:00Z); now is shortly after it fired
    // (within ALLOCATION_ANSWER_WINDOW_MINUTES) and answered=[].
    const now = new Date("2026-08-19T15:05:00Z"); // 10:05 CDT
    const lockIn = {
      start: new Date("2026-08-19T13:15:00Z"), // 08:15 CDT, inside the first window
      end: new Date("2026-08-19T13:45:00Z"),
    };
    const result = await getPendingAllocationQueue(
      "user-1",
      now,
      baseDataSource({ getWorkSessions: async () => [lockIn] })
    );

    expect(result.items.length).toBeGreaterThan(0);
    const first = result.items[0];
    expect(first.prefill.business).toBeGreaterThan(0); // Lock-In overlap -> business
    expect(new Date(first.windowStartIso).toISOString()).toBe(new Date("2026-08-19T13:00:00Z").toISOString());
  });

  it("returns no items when every fired window has already been answered", async () => {
    const now = new Date("2026-08-19T17:00:00Z");
    const result = await getPendingAllocationQueue(
      "user-1",
      now,
      baseDataSource({
        getAnsweredWindowStarts: async () => [
          new Date("2026-08-19T13:00:00Z"),
          new Date("2026-08-19T15:00:00Z"),
        ],
      })
    );
    expect(result.items).toEqual([]);
    // Every fired window is answered, so there's nothing left to fall back
    // to for a manual "check in whenever" — batch 3, B3-1.
    expect(result.mostRecentUnanswered).toBeNull();
  });

  // Batch 3, B3-1 ("check in whenever"): once a fired window's
  // ALLOCATION_ANSWER_WINDOW_MINUTES lapses unanswered it silently drops out
  // of `items` (expired_unknown) — mostRecentUnanswered is the fallback a
  // manual check-in attaches to instead of finding nothing.
  it("falls back to the most recent expired-unanswered window once items is empty", async () => {
    const now = new Date("2026-08-19T23:35:00Z"); // 18:35 CDT — well past the 16:00-18:00 CDT window's answer cutoff
    const result = await getPendingAllocationQueue("user-1", now, baseDataSource());

    expect(result.items).toEqual([]); // too late to still be in the answerable queue
    expect(result.mostRecentUnanswered).not.toBeNull();
    expect(new Date(result.mostRecentUnanswered!.windowStartIso).toISOString()).toBe(
      new Date("2026-08-19T21:00:00Z").toISOString() // 16:00 CDT — the latest fired, unanswered window
    );
    expect(result.mostRecentUnanswered!.prefill).toBeDefined();
  });

  // Regression for the bug the Opus Lead caught before ship: passing
  // computePrayerWindows' full validity windows straight through as
  // pre-fill overlap credited Deen with ~105/120 min on every afternoon
  // check-in (Dhuhr's window alone runs ~220min), regardless of whether a
  // prayer was ever logged. Only a logged prayer's actual clock time,
  // capped at one nominal STEP, may contribute now.
  it("caps the Deen prefill at one nominal STEP per logged prayer, never full validity-window overlap", async () => {
    const now = new Date("2026-08-19T21:00:00Z"); // 16:00 CDT — inside the 14:00-16:00 window
    const result = await getPendingAllocationQueue(
      "user-1",
      now,
      baseDataSource({
        getProfile: async () => ({
          timezone: "America/Chicago",
          checkin_window_start: "08:00",
          checkin_window_end: "22:00",
          location_lat: 33.1972, // McKinney, TX — real coordinates, not a stub
          location_lng: -96.6398,
          prayer_calc_method: "ISNA",
          asr_madhab: "standard",
        }),
        getLoggedPrayerNames: async () => ["dhuhr"], // logged, so it should count, but only for one STEP
      })
    );

    // Every item's deen prefill must be far below the old bug's ~105/120 —
    // one STEP (15) is the ceiling a single logged prayer can contribute.
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.prefill.deen).toBeLessThanOrEqual(15);
    }
  });

  // 2026-08-19, requested directly by Ayman: a real workout duration must
  // win over the nominal 30-minute guess when the schedule row has one.
  it("uses the real workout duration for the fitness prefill when logged AND scheduled", async () => {
    const now = new Date("2026-08-19T19:05:00Z"); // 14:05 CDT — shortly after the 12:00-14:00 window fired
    const result = await getPendingAllocationQueue(
      "user-1",
      now,
      baseDataSource({
        getWorkoutSchedule: async () => ({ time: new Date("2026-08-19T18:30:00Z"), durationMinutes: 75 }), // 13:30 CDT, inside 12:00-14:00
        getWorkoutLoggedToday: async () => true,
      })
    );

    expect(result.items.some((i) => i.prefill.fitness === 75)).toBe(true);
  });

  it("falls back to the nominal fitness default when the schedule row has no duration set", async () => {
    const now = new Date("2026-08-19T19:05:00Z"); // shortly after the 12:00-14:00 CDT window fired
    const result = await getPendingAllocationQueue(
      "user-1",
      now,
      baseDataSource({
        getWorkoutSchedule: async () => ({ time: new Date("2026-08-19T18:30:00Z"), durationMinutes: null }),
        getWorkoutLoggedToday: async () => true,
      })
    );

    expect(result.items.some((i) => i.prefill.fitness === 30)).toBe(true);
  });

  // 2026-08-19 review catch (same shape as the Deen validity-window bug):
  // a scheduled-but-never-logged workout must never credit Fitness — a
  // plan isn't evidence the session happened.
  it("does not credit fitness for a scheduled workout that was never logged", async () => {
    const now = new Date("2026-08-19T19:05:00Z"); // shortly after the 12:00-14:00 CDT window fired
    const result = await getPendingAllocationQueue(
      "user-1",
      now,
      baseDataSource({
        getWorkoutSchedule: async () => ({ time: new Date("2026-08-19T18:30:00Z"), durationMinutes: 75 }),
        getWorkoutLoggedToday: async () => false,
      })
    );

    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.prefill.fitness).toBe(0);
    }
  });

  describe("hourly Lock-In confirm / missed-hour wiring", () => {
    // A closed session with silence resolves every fired hour to
    // missed_wasted (session-hour-status.ts) with no stored row at all —
    // docs/superpowers/specs/2026-08-19-missed-lockin-hours.md's whole
    // point. This must be just as "resolved" as an explicit answer for the
    // don't-re-queue check.
    it("does not queue a window fully covered by resolved session hours, even with zero stored rows (auto-missed)", async () => {
      const now = new Date("2026-08-19T17:00:00Z"); // 12:00 CDT — well after the 08:00-10:00 window fired
      const session = {
        id: "s1",
        startedAt: new Date("2026-08-19T12:00:00Z"), // fires at 13:00Z and 14:00Z within the 13:00-15:00Z window
        endedAt: new Date("2026-08-19T15:00:00Z"),
      };
      const result = await getPendingAllocationQueue(
        "user-1",
        now,
        baseDataSource({ getSessionsForHourResolution: async () => [session], getStoredSessionHours: async () => [] })
      );

      expect(
        result.items.some((i) => new Date(i.windowStartIso).getTime() === new Date("2026-08-19T13:00:00Z").getTime())
      ).toBe(false);
    });

    // The double-count guard: an hour with its own precise, resolved value
    // (explicit answer or auto-missed) must not also get coarse-credited to
    // business by the raw Lock-In session overlap for the same 60
    // minutes — otherwise the numbers would contradict each other.
    it("subtracts resolved hours from the coarse Lock-In overlap before it reaches the prefill", async () => {
      const now = new Date("2026-08-19T21:00:00Z"); // 16:00 CDT — inside 14:00-16:00's queue window
      const lockIn: TimeRange = { start: new Date("2026-08-19T18:00:00Z"), end: new Date("2026-08-19T20:00:00Z") }; // 13:00-15:00 CDT
      const session = { id: "s1", startedAt: new Date("2026-08-19T18:00:00Z"), endedAt: new Date("2026-08-19T19:30:00Z") }; // ended before the second hour fires, so only the stored 19:00Z hour resolves
      // Only the second hour (14:00-15:00 CDT, i.e. 19:00Z) has been explicitly answered.
      const storedHours = [{ sessionId: "s1", hourStartIso: "2026-08-19T19:00:00Z", domain: "wasted" as const }];

      const withResolved = await getPendingAllocationQueue(
        "user-1",
        now,
        baseDataSource({
          getWorkSessions: async () => [lockIn],
          getSessionsForHourResolution: async () => [session],
          getStoredSessionHours: async () => storedHours,
        })
      );
      const withoutResolved = await getPendingAllocationQueue(
        "user-1",
        now,
        baseDataSource({ getWorkSessions: async () => [lockIn] })
      );

      const businessWith = withResolved.items.find(
        (i) => new Date(i.windowStartIso).getTime() === new Date("2026-08-19T19:00:00Z").getTime()
      )?.prefill.business;
      const businessWithout = withoutResolved.items.find(
        (i) => new Date(i.windowStartIso).getTime() === new Date("2026-08-19T19:00:00Z").getTime()
      )?.prefill.business;

      expect(businessWith).toBeLessThan(businessWithout ?? 0);
    });
  });

  it("passes the profile's own timezone through on the result", async () => {
    const result = await getPendingAllocationQueue(
      "user-1",
      new Date("2026-08-19T17:00:00Z"),
      baseDataSource({
        getProfile: async () => ({
          timezone: "Europe/London",
          checkin_window_start: "08:00",
          checkin_window_end: "22:00",
          location_lat: null,
          location_lng: null,
          prayer_calc_method: "ISNA",
          asr_madhab: "standard",
        }),
      })
    );
    expect(result.timezone).toBe("Europe/London");
  });
});
