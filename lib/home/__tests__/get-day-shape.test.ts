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
    getScheduleEvents: async () => [],
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

  // Classes/work — a new SOURCE for the existing activity-block mechanism,
  // not a new one (overnight session 2026-08-23/24).
  describe("schedule events (classes/work)", () => {
    function scheduleEvent(overrides: Partial<{
      title: string;
      domain: string;
      is_recurring: boolean;
      day_of_week: number | null;
      event_date: string | null;
      event_time: string | null;
      end_time: string | null;
      location: string | null;
      instructor: string | null;
      cancelled_on: string | null;
    }> = {}) {
      return {
        title: "CS-3341-HON",
        domain: "school",
        is_recurring: true,
        day_of_week: 6,
        event_date: null,
        event_time: "08:30",
        end_time: "09:45",
        location: "ECSN 2.120",
        instructor: "Nicholas Robert Ruozzi",
        cancelled_on: null,
        ...overrides,
      };
    }

    it("includes a block for a class using its real end_time, with a detail payload", async () => {
      const result = await getDayShape(
        "u1",
        NOW,
        dataSource({ getScheduleEvents: async () => [scheduleEvent()] })
      );
      expect(result.activities).toHaveLength(1);
      const block = result.activities[0];
      expect(block.label).toBe("CS-3341-HON");
      expect(block.colorVar).toBe("--series-school");
      expect(block.end).toEqual(new Date("2026-08-15T09:45:00.000Z"));
      expect(block.detail).toEqual({
        title: "CS-3341-HON",
        timeRange: "8:30 AM–9:45 AM",
        location: "ECSN 2.120",
        instructor: "Nicholas Robert Ruozzi",
        domain: "school",
      });
    });

    it("colors work (co_op domain) distinctly from classes", async () => {
      const result = await getDayShape(
        "u1",
        NOW,
        dataSource({
          getScheduleEvents: async () => [scheduleEvent({ title: "Work", domain: "co_op", location: null, instructor: null })],
        })
      );
      expect(result.activities[0].colorVar).toBe("--series-coop");
    });

    it("falls back to a nominal duration when end_time is null", async () => {
      const result = await getDayShape(
        "u1",
        NOW,
        dataSource({ getScheduleEvents: async () => [scheduleEvent({ end_time: null })] })
      );
      const block = result.activities[0];
      expect(block.end).toEqual(new Date(block.start.getTime() + 60 * 60_000));
    });

    it("excludes an event with no event_time at all — nothing to anchor it on the timeline", async () => {
      const result = await getDayShape(
        "u1",
        NOW,
        dataSource({ getScheduleEvents: async () => [scheduleEvent({ event_time: null })] })
      );
      expect(result.activities).toHaveLength(0);
    });

    it("excludes a class cancelled for today's specific occurrence", async () => {
      const result = await getDayShape(
        "u1",
        NOW,
        dataSource({ getScheduleEvents: async () => [scheduleEvent({ cancelled_on: "2026-08-15" })] })
      );
      expect(result.activities).toHaveLength(0);
    });

    it("still renders a class cancelled on a DIFFERENT date", async () => {
      const result = await getDayShape(
        "u1",
        NOW,
        dataSource({ getScheduleEvents: async () => [scheduleEvent({ cancelled_on: "2026-08-10" })] })
      );
      expect(result.activities).toHaveLength(1);
    });
  });
});
