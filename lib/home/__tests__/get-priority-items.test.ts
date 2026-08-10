import { describe, expect, it } from "vitest";
import { getPriorityItems, type HomeDataSource } from "../get-priority-items";
import { calculatePrayerTimes } from "../../prayer-times/calculate";

const CHICAGO_PROFILE = {
  location_lat: 41.8781,
  location_lng: -87.6298,
  timezone: "America/Chicago",
  prayer_calc_method: "MWL" as const,
  asr_madhab: "standard" as const,
};

function emptyDataSource(overrides: Partial<HomeDataSource> = {}): HomeDataSource {
  return {
    getProfile: async () => CHICAGO_PROFILE,
    getPrayers: async () => [],
    getAdhkarLogs: async () => [],
    getKillListItems: async () => [],
    getTasks: async () => [],
    getWorkoutSchedule: async () => null,
    getWorkoutLogs: async () => [],
    ...overrides,
  };
}

describe("getPriorityItems", () => {
  it("buckets an unprayed prayer due within 30 minutes as right_now", async () => {
    const now = new Date("2026-08-10T00:00:00Z");
    const times = calculatePrayerTimes({
      date: now,
      lat: CHICAGO_PROFILE.location_lat,
      lng: CHICAGO_PROFILE.location_lng,
      timezoneOffsetMinutes: -300,
      calcMethod: "MWL",
      asrMadhab: "standard",
    });
    const thirtyMinBeforeDhuhr = new Date(times.dhuhr.getTime() - 30 * 60_000);

    const dataSource = emptyDataSource({
      getPrayers: async () => [
        { id: "p1", prayer_name: "dhuhr", status: "pending" },
      ],
    });

    const items = await getPriorityItems("user-1", thirtyMinBeforeDhuhr, dataSource);
    const dhuhrItem = items.find((i) => i.actionRefId === "dhuhr");

    expect(dhuhrItem).toBeDefined();
    expect(dhuhrItem?.urgencyBucket).toBe("right_now");
    expect(dhuhrItem?.actionType).toBe("toggle_prayer");
    expect(dhuhrItem?.domain).toBe("deen");
  });

  it("buckets a task due today with no time as later_today", async () => {
    const now = new Date("2026-08-10T18:00:00Z");
    const dataSource = emptyDataSource({
      getTasks: async () => [
        {
          id: "t1",
          domain: "school",
          title: "Read chapter 4",
          due_date: "2026-08-10",
          due_time: null,
          completed: false,
        },
      ],
    });

    const items = await getPriorityItems("user-1", now, dataSource);
    const task = items.find((i) => i.actionRefId === "t1");

    expect(task).toBeDefined();
    expect(task?.urgencyBucket).toBe("later_today");
    expect(task?.dueAt).toBeNull();
  });

  it("excludes a completed prayer entirely", async () => {
    const now = new Date("2026-08-10T18:00:00Z");
    const dataSource = emptyDataSource({
      getPrayers: async () => [
        { id: "p1", prayer_name: "fajr", status: "on_time" },
      ],
    });

    const items = await getPriorityItems("user-1", now, dataSource);

    expect(items.find((i) => i.actionRefId === "fajr")).toBeUndefined();
  });

  it("includes an incomplete morning adhkar as a later_today item", async () => {
    const now = new Date("2026-08-10T14:00:00Z");
    const dataSource = emptyDataSource({
      getAdhkarLogs: async () => [{ id: "a1", period: "morning", completed: false }],
    });

    const items = await getPriorityItems("user-1", now, dataSource);
    const adhkar = items.find((i) => i.actionType === "toggle_adhkar" && i.actionRefId === "morning");

    expect(adhkar).toBeDefined();
    expect(adhkar?.domain).toBe("deen");
    expect(adhkar?.urgencyBucket).toBe("later_today");
    expect(adhkar?.completed).toBe(false);
  });

  it("orders items due at the exact same moment by domain priority (Deen before School/Co-op)", async () => {
    const now = new Date("2026-08-10T00:00:00Z");
    const times = calculatePrayerTimes({
      date: now,
      lat: CHICAGO_PROFILE.location_lat,
      lng: CHICAGO_PROFILE.location_lng,
      timezoneOffsetMinutes: -300,
      calcMethod: "MWL",
      asrMadhab: "standard",
    });
    // due_time is a local HH:MM string; the aggregator must resolve it against
    // the same profile timezone used for prayer times to land on the same instant.
    const dhuhrLocal = new Date(times.dhuhr.getTime() - 300 * 60_000);
    const hh = String(dhuhrLocal.getUTCHours()).padStart(2, "0");
    const mm = String(dhuhrLocal.getUTCMinutes()).padStart(2, "0");

    const dataSource = emptyDataSource({
      getPrayers: async () => [{ id: "p1", prayer_name: "dhuhr", status: "pending" }],
      getTasks: async () => [
        {
          id: "school1",
          domain: "school",
          title: "Exam",
          due_date: "2026-08-10",
          due_time: `${hh}:${mm}`,
          completed: false,
        },
        {
          id: "coop1",
          domain: "co_op",
          title: "Standup",
          due_date: "2026-08-10",
          due_time: `${hh}:${mm}`,
          completed: false,
        },
      ],
    });

    const items = await getPriorityItems("user-1", times.dhuhr, dataSource);
    const order = items.map((i) => i.actionRefId);

    expect(order.indexOf("dhuhr")).toBeLessThan(order.indexOf("school1"));
    expect(order.indexOf("dhuhr")).toBeLessThan(order.indexOf("coop1"));
  });

  it("includes a scheduled-but-unlogged workout as a later_today Fitness item", async () => {
    const now = new Date("2026-08-10T18:00:00Z"); // 2026-08-10 is a Monday
    const dataSource = emptyDataSource({
      getWorkoutSchedule: async () => ({ day_of_week: 1, workout_name: "Push" }),
      getWorkoutLogs: async () => [],
    });

    const items = await getPriorityItems("user-1", now, dataSource);
    const workout = items.find((i) => i.actionType === "toggle_workout");

    expect(workout).toBeDefined();
    expect(workout?.domain).toBe("fitness");
    expect(workout?.title).toBe("Push");
    expect(workout?.actionRefId).toBe("Push");
    expect(workout?.urgencyBucket).toBe("later_today");
  });

  it("excludes a scheduled workout that's already logged today", async () => {
    const now = new Date("2026-08-10T18:00:00Z");
    const dataSource = emptyDataSource({
      getWorkoutSchedule: async () => ({ day_of_week: 1, workout_name: "Push" }),
      getWorkoutLogs: async () => [{ workout_name: "Push" }],
    });

    const items = await getPriorityItems("user-1", now, dataSource);

    expect(items.find((i) => i.actionType === "toggle_workout")).toBeUndefined();
  });

  it("orders items with no specific due time by domain priority (Business before School)", async () => {
    const now = new Date("2026-08-10T18:00:00Z");
    const dataSource = emptyDataSource({
      getKillListItems: async () => [
        { id: "k1", text: "Ship the landing page", completed: false, position: 0 },
      ],
      getTasks: async () => [
        {
          id: "school1",
          domain: "school",
          title: "Read chapter 4",
          due_date: "2026-08-10",
          due_time: null,
          completed: false,
        },
      ],
    });

    const items = await getPriorityItems("user-1", now, dataSource);
    const order = items.map((i) => i.actionRefId);

    expect(order.indexOf("k1")).toBeLessThan(order.indexOf("school1"));
  });
});
