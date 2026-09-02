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
      checkin_window_start: "08:00",
      checkin_window_end: "22:00",
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
      dataSource({
        getProfile: async () => ({
          location_lat: null,
          location_lng: null,
          timezone: "UTC",
          prayer_calc_method: "MWL",
          asr_madhab: "standard",
          checkin_window_start: "08:00",
          checkin_window_end: "22:00",
        }),
      })
    );
    expect(result.prayers.every((p) => p.window === null)).toBe(true);
    expect(result.prayers.every((p) => p.status === "pending")).toBe(true);
  });

  it("computes real windows and statuses when a location is set", async () => {
    const result = await getDayShape("u1", NOW, dataSource());
    expect(result.prayers.every((p) => p.window !== null)).toBe(true);
  });

  // A3 Part 1: dayBounds comes from profiles.checkin_window_start/end, not
  // from prayers — a location-less account (no window computable at all,
  // see the "no location" test above) must still get a real dayBounds.
  describe("dayBounds", () => {
    it("resolves start/end from checkin_window_start/end against the profile's own timezone", async () => {
      const result = await getDayShape(
        "u1",
        NOW,
        dataSource({
          getProfile: async () => ({
            location_lat: 41.83,
            location_lng: -87.75,
            timezone: "America/Chicago",
            prayer_calc_method: "MWL",
            asr_madhab: "standard",
            checkin_window_start: "06:30",
            checkin_window_end: "23:00",
          }),
        })
      );
      // 2026-08-15 in America/Chicago is CDT (UTC-5).
      expect(result.dayBounds.start).toEqual(new Date("2026-08-15T11:30:00.000Z"));
      expect(result.dayBounds.end).toEqual(new Date("2026-08-16T04:00:00.000Z"));
    });

    it("still produces valid dayBounds when there's no location set at all — the axis never depends on Faith", async () => {
      const result = await getDayShape(
        "u1",
        NOW,
        dataSource({
          getProfile: async () => ({
            location_lat: null,
            location_lng: null,
            timezone: "UTC",
            prayer_calc_method: "MWL",
            asr_madhab: "standard",
            checkin_window_start: "08:00",
            checkin_window_end: "22:00",
          }),
        })
      );
      expect(result.dayBounds).toEqual({ start: new Date("2026-08-15T08:00:00.000Z"), end: new Date("2026-08-15T22:00:00.000Z") });
    });

    it("falls back to the same 08:00/22:00 defaults the DB columns carry when there's no profile row at all", async () => {
      const result = await getDayShape("u1", NOW, dataSource({ getProfile: async () => null }));
      expect(result.dayBounds).toEqual({ start: new Date("2026-08-15T08:00:00.000Z"), end: new Date("2026-08-15T22:00:00.000Z") });
    });
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
          { started_at: "2026-08-15T14:00:00Z", ended_at: "2026-08-15T15:30:00Z", kind: "deep_work" },
          { started_at: "2026-08-15T16:30:00Z", ended_at: null, kind: "deep_study" },
        ],
      })
    );
    const sessionBlocks = result.activities.filter((a) => a.kind === "focus");
    expect(sessionBlocks).toHaveLength(2);
    expect(sessionBlocks[0].label).toBe("Deep Work");
    expect(sessionBlocks[0].end).toEqual(new Date("2026-08-15T15:30:00Z"));
    expect(sessionBlocks[1].label).toBe("Deep Study");
    expect(sessionBlocks[1].end).toBeNull();
  });

  // Classes/work — a new SOURCE for the existing activity-block mechanism,
  // not a new one (overnight session 2026-08-23/24).
  describe("schedule events (classes/work)", () => {
    function scheduleEvent(overrides: Partial<{
      id: string;
      title: string;
      domain: string;
      is_recurring: boolean;
      day_of_week: number | null;
      event_date: string | null;
      event_time: string | null;
      end_time: string | null;
      location: string | null;
      instructor: string | null;
      cancelled: boolean;
    }> = {}) {
      return {
        id: "e1",
        title: "CS-3341-HON",
        domain: "school",
        is_recurring: true,
        day_of_week: 6,
        event_date: null,
        event_time: "08:30",
        end_time: "09:45",
        location: "ECSN 2.120",
        instructor: "Nicholas Robert Ruozzi",
        cancelled: false,
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
      expect(block.kind).toBe("class");
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
      expect(result.activities[0].kind).toBe("work");
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
        dataSource({ getScheduleEvents: async () => [scheduleEvent({ cancelled: true })] })
      );
      expect(result.activities).toHaveLength(0);
    });

    it("still renders a class whose cancellation was for a DIFFERENT date", async () => {
      // The data source resolves `cancelled` against today's date already
      // (see defaultDataSource's getScheduleEvents) — a cancellation on
      // another date simply never sets this flag true for today's row.
      const result = await getDayShape(
        "u1",
        NOW,
        dataSource({ getScheduleEvents: async () => [scheduleEvent({ cancelled: false })] })
      );
      expect(result.activities).toHaveLength(1);
    });
  });
});
