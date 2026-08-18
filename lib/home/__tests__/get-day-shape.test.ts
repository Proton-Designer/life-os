import { describe, expect, it } from "vitest";
import { getDayShape, type DayShapeDataSource } from "../get-day-shape";

const NOW = new Date("2026-08-15T17:00:00Z"); // midday UTC, matches "UTC" timezone below

function dataSource(overrides: Partial<DayShapeDataSource> = {}): DayShapeDataSource {
  return {
    getProfile: async () => ({
      location_lat: 41.83,
      location_lng: -87.75,
      timezone: "UTC",
      prayer_calc_method: "MWL",
      asr_madhab: "standard",
    }),
    getPrayers: async () => [],
    getWorkoutSchedule: async () => null,
    getTimedTasks: async () => [],
    getFocusSessions: async () => [],
    ...overrides,
  };
}

describe("getDayShape", () => {
  it("always returns all 5 prayers, in Fajr..Isha order", async () => {
    const result = await getDayShape("u1", NOW, dataSource());
    expect(result.prayers.map((p) => p.name)).toEqual(["fajr", "dhuhr", "asr", "maghrib", "isha"]);
  });

  it("gives every prayer a null window when no location is set", async () => {
    const result = await getDayShape(
      "u1",
      NOW,
      dataSource({ getProfile: async () => ({ location_lat: null, location_lng: null, timezone: "UTC", prayer_calc_method: "MWL", asr_madhab: "standard" }) })
    );
    expect(result.prayers.every((p) => p.window === null)).toBe(true);
    expect(result.prayers.every((p) => p.status === "pending")).toBe(true);
  });

  it("computes real windows and statuses when a location is set", async () => {
    const result = await getDayShape("u1", NOW, dataSource());
    expect(result.prayers.every((p) => p.window !== null)).toBe(true);
  });

  it("a stored status always wins over the derived one", async () => {
    const result = await getDayShape(
      "u1",
      NOW,
      dataSource({ getPrayers: async () => [{ prayer_name: "fajr", status: "missed" }] })
    );
    expect(result.prayers.find((p) => p.name === "fajr")?.status).toBe("missed");
  });

  it("includes no workout activity when nothing is scheduled today", async () => {
    const result = await getDayShape("u1", NOW, dataSource());
    expect(result.activities.filter((a) => a.label !== undefined)).toHaveLength(0);
  });

  it("includes a workout block only when the scheduled workout has a time", async () => {
    const noTime = await getDayShape(
      "u1",
      NOW,
      dataSource({ getWorkoutSchedule: async () => ({ workout_name: "Push day", time: null }) })
    );
    expect(noTime.activities).toHaveLength(0);

    const withTime = await getDayShape(
      "u1",
      NOW,
      dataSource({ getWorkoutSchedule: async () => ({ workout_name: "Push day", time: "07:00" }) })
    );
    expect(withTime.activities).toHaveLength(1);
    expect(withTime.activities[0].label).toBe("Push day");
    expect(withTime.activities[0].end).not.toBeNull();
  });

  it("includes a block per timed task, anchored at its due time", async () => {
    const result = await getDayShape(
      "u1",
      NOW,
      dataSource({
        getTimedTasks: async () => [
          { title: "Submit essay", domain: "school", due_time: "14:00" },
          { title: "File permit", domain: "co_op", due_time: "16:00" },
        ],
      })
    );
    expect(result.activities.map((a) => a.label)).toEqual(["Submit essay", "File permit"]);
    expect(result.activities.every((a) => a.end !== null)).toBe(true);
  });

  it("includes a block per focus session, open-ended (null end) if still active", async () => {
    const result = await getDayShape(
      "u1",
      NOW,
      dataSource({
        getFocusSessions: async () => [
          { started_at: "2026-08-15T14:00:00Z", ended_at: "2026-08-15T15:30:00Z" },
          { started_at: "2026-08-15T16:30:00Z", ended_at: null },
        ],
      })
    );
    const sessionBlocks = result.activities.filter((a) => a.label === "Focus session");
    expect(sessionBlocks).toHaveLength(2);
    expect(sessionBlocks[0].end).toEqual(new Date("2026-08-15T15:30:00Z"));
    expect(sessionBlocks[1].end).toBeNull();
  });
});
