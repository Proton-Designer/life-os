import { describe, expect, it } from "vitest";
import { getPendingAllocationQueue, type AllocationQueueDataSource } from "../get-allocation-queue";

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
    getWorkoutTime: async () => null,
    getAnsweredWindowStarts: async () => [],
    getLoggedPrayerNames: async () => [],
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
    expect(result).toEqual({ items: [], unknownCount: 0, timezone: "UTC" });
  });

  it("surfaces a fired, unanswered window as a pending item with a prefill derived from real data", async () => {
    // 08:00-10:00 CDT window; now is well after it fired and answered=[].
    const now = new Date("2026-08-19T17:00:00Z"); // 12:00 CDT
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
