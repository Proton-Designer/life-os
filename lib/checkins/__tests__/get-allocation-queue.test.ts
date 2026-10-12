import { describe, expect, it } from "vitest";
import { getPendingAllocationQueue, type AllocationQueueDataSource } from "../get-allocation-queue";
import type { SessionRange } from "../session-accounting";

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
      deen_mode: true,
    }),
    getWorkSessions: async () => [],
    getWorkoutSchedule: async () => null,
    getAnsweredWindowStarts: async () => [],
    getLoggedPrayerNames: async () => [],
    getWorkoutLoggedToday: async () => false,
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
    expect(result).toEqual({ items: [], unknownCount: 0, timezone: "UTC", deenMode: false, mostRecentUnanswered: null, enabled: false });
  });

  it("is off by choice (allocation_checkins_enabled false): no queue, no 'check in whenever' fallback, and the sources are not even read", async () => {
    let read = 0;
    const result = await getPendingAllocationQueue(
      "user-1",
      new Date("2026-08-19T18:00:00Z"), // well after the first windows fired
      baseDataSource({
        getProfile: async () => ({ ...(await baseDataSource().getProfile("user-1"))!, allocation_checkins_enabled: false }),
        getWorkSessions: async () => (read++, []),
      })
    );
    expect(result).toMatchObject({ items: [], unknownCount: 0, mostRecentUnanswered: null, enabled: false });
    expect(read).toBe(0);
  });

  it("positive control: the same account with it on gets a queue and enabled true (a source that doesn't select the column reads as on)", async () => {
    for (const flag of [true, undefined]) {
      const result = await getPendingAllocationQueue(
        "user-1",
        new Date("2026-08-19T18:00:00Z"),
        baseDataSource({ getProfile: async () => ({ ...(await baseDataSource().getProfile("user-1"))!, allocation_checkins_enabled: flag }) })
      );
      expect(result.enabled).toBe(true);
      expect(result.mostRecentUnanswered).not.toBeNull();
    }
  });

  it("surfaces a fired, unanswered window as a pending item with a prefill derived from real data", async () => {
    // 08:00-10:00 CDT window (fires 15:00Z); now is shortly after it fired
    // (within ALLOCATION_ANSWER_WINDOW_MINUTES) and answered=[].
    const now = new Date("2026-08-19T15:05:00Z"); // 10:05 CDT
    const lockIn = {
      start: new Date("2026-08-19T13:15:00Z"), // 08:15 CDT, inside the first window
      end: new Date("2026-08-19T13:45:00Z"),
      domain: "business" as const,
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
  it("caps the Faith prefill at one nominal STEP per logged prayer, never full validity-window overlap", async () => {
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
          deen_mode: true,
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

  describe("sessions account for themselves", () => {
    // A finished session that covers a whole window is accounted for by the session: the window is never queued.
    it("does not queue a window the finished sessions cover end to end", async () => {
      const now = new Date("2026-08-19T17:00:00Z"); // 12:00 CDT, well after the 08:00-10:00 window fired
      const session: SessionRange = { start: new Date("2026-08-19T13:00:00Z"), end: new Date("2026-08-19T15:00:00Z"), domain: "business" };
      const result = await getPendingAllocationQueue("user-1", now, baseDataSource({ getWorkSessions: async () => [session] }));

      expect(
        result.items.some((i) => new Date(i.windowStartIso).getTime() === new Date("2026-08-19T13:00:00Z").getTime())
      ).toBe(false);
    });

    it("still queues a window a session only partly covers, pre-filled with the overlap in the session's own domain", async () => {
      const now = new Date("2026-08-19T15:05:00Z"); // 10:05 CDT, inside the 08:00-10:00 window's answer period
      const study: SessionRange = { start: new Date("2026-08-19T13:15:00Z"), end: new Date("2026-08-19T14:00:00Z"), domain: "school" };
      const result = await getPendingAllocationQueue("user-1", now, baseDataSource({ getWorkSessions: async () => [study] }));

      const first = result.items.find((i) => new Date(i.windowStartIso).getTime() === new Date("2026-08-19T13:00:00Z").getTime());
      expect(first?.prefill.school).toBe(45); // Deep Study -> School
      expect(first?.prefill.business).toBe(0);
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

  // Deen Mode OFF: no prayer queries, no prayer-window suppression, no Deen prefill.
  describe("Faith Mode gate", () => {
    const MCKINNEY = {
      timezone: "America/Chicago",
      checkin_window_start: "08:00",
      checkin_window_end: "22:00",
      location_lat: 33.1972,
      location_lng: -96.6398,
      prayer_calc_method: "ISNA",
      asr_madhab: "standard",
    };
    const NOW = new Date("2026-08-19T21:00:00Z"); // 16:00 CDT

    it("ON: reads logged prayers and reports deenMode true", async () => {
      let prayerReads = 0;
      const result = await getPendingAllocationQueue(
        "user-1",
        NOW,
        baseDataSource({
          getProfile: async () => ({ ...MCKINNEY, deen_mode: true }),
          getLoggedPrayerNames: async () => {
            prayerReads++;
            return ["dhuhr"];
          },
        })
      );
      expect(result.deenMode).toBe(true);
      expect(prayerReads).toBe(1);
    });

    it("OFF (false, null, or missing): never reads prayers, zero Faith prefill, deenMode false", async () => {
      for (const deen_mode of [false, null, undefined]) {
        let prayerReads = 0;
        const result = await getPendingAllocationQueue(
          "user-1",
          NOW,
          baseDataSource({
            getProfile: async () => ({ ...MCKINNEY, deen_mode }),
            getLoggedPrayerNames: async () => {
              prayerReads++;
              return ["dhuhr"];
            },
          })
        );
        expect(result.deenMode, String(deen_mode)).toBe(false);
        expect(prayerReads, String(deen_mode)).toBe(0);
        for (const item of result.items) expect(item.prefill.deen ?? 0).toBe(0);
      }
    });

    it("OFF: prayer times no longer suppress windows (the same data set yields at least as many slots as ON)", async () => {
      const run = (deen_mode: boolean) =>
        getPendingAllocationQueue(
          "user-1",
          NOW,
          baseDataSource({ getProfile: async () => ({ ...MCKINNEY, deen_mode }) })
        );
      const on = await run(true);
      const off = await run(false);
      expect(off.items.length).toBeGreaterThanOrEqual(on.items.length);
    });
  });
});
