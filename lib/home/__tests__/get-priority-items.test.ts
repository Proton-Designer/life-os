import { describe, expect, it, vi } from "vitest";
import { getPriorityItems, getCompletedItemsToday, type HomeDataSource } from "../get-priority-items";
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
    getSunnahCompletions: async () => [],
    getKillListItems: async () => [],
    getTasks: async () => [],
    getTasksCompletedBetween: async () => [],
    getFitness: async () => ({ microPlanName: null, microTotals: [], microFreqs: [], sessions: [] }),
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
        { id: "p1", prayer_name: "dhuhr", status: "pending", logged_at: null },
      ],
    });

    const items = await getPriorityItems("user-1", thirtyMinBeforeDhuhr, dataSource);
    const dhuhrItem = items.find((i) => i.actionRefId === "dhuhr");

    expect(dhuhrItem).toBeDefined();
    expect(dhuhrItem?.urgencyBucket).toBe("right_now");
    expect(dhuhrItem?.actionType).toBe("toggle_prayer");
    expect(dhuhrItem?.domain).toBe("deen");
  });

  it("carries a prayer's already-completed sunnah slots on its PriorityItem, scoped to that prayer only", async () => {
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
      getPrayers: async () => [{ id: "p1", prayer_name: "dhuhr", status: "pending", logged_at: null }],
      getSunnahCompletions: async () => [
        { prayer_name: "dhuhr", slot: "before" },
        { prayer_name: "fajr", slot: "before" },
      ],
    });

    const items = await getPriorityItems("user-1", thirtyMinBeforeDhuhr, dataSource);
    const dhuhrItem = items.find((i) => i.actionRefId === "dhuhr");

    expect(dhuhrItem?.sunnahCompletions).toEqual(["before"]);
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
          completed_at: null,
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
        { id: "p1", prayer_name: "fajr", status: "on_time", logged_at: null },
      ],
    });

    const items = await getPriorityItems("user-1", now, dataSource);

    expect(items.find((i) => i.actionRefId === "fajr")).toBeUndefined();
  });

  it("excludes an unlogged prayer whose window has already closed (missed, not pending)", async () => {
    // Late evening in Chicago — Fajr's window (ends at sunrise) closed many hours ago.
    const now = new Date("2026-08-10T23:00:00Z"); // ~6pm CDT
    const dataSource = emptyDataSource({ getPrayers: async () => [] });

    const items = await getPriorityItems("user-1", now, dataSource);

    expect(items.find((i) => i.actionRefId === "fajr")).toBeUndefined();
  });

  it("excludes an unlogged prayer whose window hasn't opened and isn't within the right-now lookahead (fixes 'all five from midnight')", async () => {
    // Early morning — Isha's window is many hours away, well outside the 2h lookahead.
    const now = new Date("2026-08-10T11:00:00Z"); // ~6am CDT
    const dataSource = emptyDataSource({ getPrayers: async () => [] });

    const items = await getPriorityItems("user-1", now, dataSource);

    expect(items.find((i) => i.actionRefId === "isha")).toBeUndefined();
  });

  it("always shows the kill list's first incomplete item's own text, never a count of how many remain", async () => {
    const now = new Date("2026-08-10T18:00:00Z");
    const dataSource = emptyDataSource({
      getKillListItems: async () => [
        { id: "k1", text: "Call the vendor", completed: false, position: 0, completed_at: null },
        { id: "k2", text: "Send the proposal", completed: false, position: 1, completed_at: null },
        { id: "k3", text: "Review contract", completed: false, position: 2, completed_at: null },
      ],
    });

    const items = await getPriorityItems("user-1", now, dataSource);
    const killItem = items.find((i) => i.id === "kill-list");

    expect(killItem?.title).toBe("Call the vendor");
    expect(killItem?.actionRefId).toBe("k1");
  });

  it("advances to the next kill-list item's own text once the first is completed — never a count, at any remaining size", async () => {
    const now = new Date("2026-08-10T18:00:00Z");
    const dataSource = emptyDataSource({
      getKillListItems: async () => [
        { id: "k1", text: "Call the vendor", completed: true, position: 0, completed_at: null },
        { id: "k2", text: "Send the proposal", completed: false, position: 1, completed_at: null },
        { id: "k3", text: "Review contract", completed: false, position: 2, completed_at: null },
      ],
    });

    const items = await getPriorityItems("user-1", now, dataSource);
    const killItem = items.find((i) => i.id === "kill-list");

    expect(killItem?.title).toBe("Send the proposal");
    expect(killItem?.actionRefId).toBe("k2");
  });

  it("emits no kill-list row once all three items are completed", async () => {
    const now = new Date("2026-08-10T18:00:00Z");
    const dataSource = emptyDataSource({
      getKillListItems: async () => [
        { id: "k1", text: "Call the vendor", completed: true, position: 0, completed_at: null },
        { id: "k2", text: "Send the proposal", completed: true, position: 1, completed_at: null },
        { id: "k3", text: "Review contract", completed: true, position: 2, completed_at: null },
      ],
    });

    const items = await getPriorityItems("user-1", now, dataSource);

    expect(items.some((i) => i.id === "kill-list")).toBe(false);
  });

  it("orders items due at the exact same moment by domain priority (Deen before School/Work)", async () => {
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
      getPrayers: async () => [{ id: "p1", prayer_name: "dhuhr", status: "pending", logged_at: null }],
      getTasks: async () => [
        {
          id: "school1",
          domain: "school",
          title: "Exam",
          due_date: "2026-08-10",
          due_time: `${hh}:${mm}`,
          completed: false,
          completed_at: null,
        },
        {
          id: "coop1",
          domain: "co_op",
          title: "Standup",
          due_date: "2026-08-10",
          due_time: `${hh}:${mm}`,
          completed: false,
          completed_at: null,
        },
      ],
    });

    const items = await getPriorityItems("user-1", times.dhuhr, dataSource);
    const order = items.map((i) => i.actionRefId);

    expect(order.indexOf("dhuhr")).toBeLessThan(order.indexOf("school1"));
    expect(order.indexOf("dhuhr")).toBeLessThan(order.indexOf("coop1"));
  });

  // The two toggle_workout tests that lived here are deleted, not
  // repointed (Fitness redesign Phase 7, 2026-08-20): the item they
  // asserted was a bare one-tap workout completion with no numbers shown,
  // which spec §2.1 forbids for the new confirm flow. See the
  // "fitness row" describe block below for the current replacement
  // (docs/superpowers/specs/2026-08-23-home-fitness-row.md).

  it("orders items with no specific due time by domain priority (Business before School)", async () => {
    const now = new Date("2026-08-10T18:00:00Z");
    const dataSource = emptyDataSource({
      getKillListItems: async () => [
        { id: "k1", text: "Ship the landing page", completed: false, position: 0, completed_at: null },
      ],
      getTasks: async () => [
        {
          id: "school1",
          domain: "school",
          title: "Read chapter 4",
          due_date: "2026-08-10",
          due_time: null,
          completed: false,
          completed_at: null,
        },
      ],
    });

    const items = await getPriorityItems("user-1", now, dataSource);
    const order = items.map((i) => i.actionRefId);

    expect(order.indexOf("k1")).toBeLessThan(order.indexOf("school1"));
  });

  // Home "Now" fitness row — docs/superpowers/specs/2026-08-23-home-fitness-row.md.
  // One row max, naming today's workout; never a bare toggle.
  describe("fitness row", () => {
    const now = new Date("2026-08-10T18:00:00Z");

    it("emits a row titled with the session's own name when a session is scheduled and unconfirmed", async () => {
      const dataSource = emptyDataSource({
        getFitness: async () => ({
          microPlanName: null,
          microTotals: [],
          microFreqs: [],
          sessions: [{ sessionId: "s1", name: "Push Day A", durationMinutes: 45, startTime: null, confirmedToday: false }],
        }),
      });

      const items = await getPriorityItems("user-1", now, dataSource);
      const fitnessItem = items.find((i) => i.domain === "fitness");

      expect(fitnessItem).toBeDefined();
      expect(fitnessItem?.title).toBe("Push Day A");
      expect(fitnessItem?.actionType).toBe("open_fitness");
      expect(fitnessItem?.actionRefId).toBe("s1");
    });

    it("emits a row titled with the active micro plan's name when only micro goals are unmet", async () => {
      const dataSource = emptyDataSource({
        getFitness: async () => ({
          microPlanName: "Starter Reps",
          microTotals: [{ exerciseId: "e1", name: "Pull-ups", target: 30, loggedToday: 10, notes: null }],
          microFreqs: [],
          sessions: [],
        }),
      });

      const items = await getPriorityItems("user-1", now, dataSource);
      const fitnessItem = items.find((i) => i.domain === "fitness");

      expect(fitnessItem).toBeDefined();
      expect(fitnessItem?.title).toBe("Starter Reps");
      expect(fitnessItem?.actionType).toBe("open_fitness");
    });

    it("shows only the session's name (never both, never concatenated) when both a session and micro goals are pending", async () => {
      const dataSource = emptyDataSource({
        getFitness: async () => ({
          microPlanName: "Starter Reps",
          microTotals: [{ exerciseId: "e1", name: "Pull-ups", target: 30, loggedToday: 0, notes: null }],
          microFreqs: [],
          sessions: [{ sessionId: "s1", name: "Push Day A", durationMinutes: 45, startTime: null, confirmedToday: false }],
        }),
      });

      const items = await getPriorityItems("user-1", now, dataSource);
      const fitnessItems = items.filter((i) => i.domain === "fitness");

      expect(fitnessItems).toHaveLength(1);
      expect(fitnessItems[0].title).toBe("Push Day A");
    });

    it("emits no fitness row when nothing is scheduled today", async () => {
      const dataSource = emptyDataSource();
      const items = await getPriorityItems("user-1", now, dataSource);
      expect(items.some((i) => i.domain === "fitness")).toBe(false);
    });

    it("emits no fitness row once the session is confirmed and every micro goal is met", async () => {
      const dataSource = emptyDataSource({
        getFitness: async () => ({
          microPlanName: "Starter Reps",
          microTotals: [{ exerciseId: "e1", name: "Pull-ups", target: 30, loggedToday: 30, notes: null }],
          microFreqs: [],
          sessions: [{ sessionId: "s1", name: "Push Day A", durationMinutes: 45, startTime: null, confirmedToday: true }],
        }),
      });

      const items = await getPriorityItems("user-1", now, dataSource);
      expect(items.some((i) => i.domain === "fitness")).toBe(false);
    });
  });

  describe("getCompletedItemsToday", () => {
    const now = new Date("2026-08-10T18:00:00Z");

    it("includes an on_time or qada prayer with its logged_at as completedAtIso", async () => {
      const dataSource = emptyDataSource({
        getPrayers: async () => [
          { id: "p1", prayer_name: "fajr", status: "on_time", logged_at: "2026-08-10T11:00:00Z" },
          { id: "p2", prayer_name: "dhuhr", status: "qada", logged_at: "2026-08-10T17:00:00Z" },
          { id: "p3", prayer_name: "asr", status: "pending", logged_at: null },
        ],
      });

      const items = await getCompletedItemsToday("user-1", now, dataSource);
      const ids = items.map((i) => i.actionRefId);

      expect(ids).toEqual(["fajr", "dhuhr"]);
      expect(items.find((i) => i.actionRefId === "fajr")?.completedAtIso).toBe("2026-08-10T11:00:00Z");
    });

    it("includes a completed kill-list item with its completed_at as completedAtIso", async () => {
      const dataSource = emptyDataSource({
        getKillListItems: async () => [
          { id: "k1", text: "Call the vendor", completed: true, position: 0, completed_at: "2026-08-10T15:00:00Z" },
          { id: "k2", text: "Send the proposal", completed: false, position: 1, completed_at: null },
        ],
      });

      const items = await getCompletedItemsToday("user-1", now, dataSource);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ domain: "business", title: "Call the vendor", actionRefId: "k1" });
    });

    it("includes a completed task with its completed_at as completedAtIso — reads getTasksCompletedBetween, not getTasks", async () => {
      const getTasks = vi.fn(async () => []);
      const dataSource = emptyDataSource({
        getTasks,
        getTasksCompletedBetween: async (userId, dayStartIso, dayEndIso) => {
          expect(dayStartIso).toBe("2026-08-10T05:00:00.000Z"); // local midnight in Chicago (UTC-5)
          expect(dayEndIso).toBe("2026-08-11T05:00:00.000Z");
          return [
            {
              id: "t1",
              domain: "school",
              title: "Read chapter 4",
              due_date: "2026-08-05", // due a different day — still counts, since "completed today" is completed_at-scoped, not due_date-scoped
              due_time: null,
              completed: true,
              completed_at: "2026-08-10T16:00:00Z",
            },
          ];
        },
      });

      const items = await getCompletedItemsToday("user-1", now, dataSource);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ domain: "school", title: "Read chapter 4", actionRefId: "t1" });
      // getPriorityItems' own due-date-scoped query is never consulted here.
      expect(getTasks).not.toHaveBeenCalled();
    });

    it("bounds the completed-task window by the LOCAL day, not a naive UTC-date string, near midnight either side", async () => {
      // 23:30 local (Chicago, UTC-5) on 2026-08-10 is 2026-08-11T04:30:00Z —
      // still "today" (Aug 10) locally, must fall inside [dayStartIso, dayEndIso).
      const at2330Local = new Date("2026-08-11T04:30:00.000Z");
      let bounds2330: [string, string] | null = null;
      await getCompletedItemsToday(
        "user-1",
        at2330Local,
        emptyDataSource({
          getTasksCompletedBetween: async (userId, dayStartIso, dayEndIso) => {
            bounds2330 = [dayStartIso, dayEndIso];
            return [];
          },
        })
      );
      expect(bounds2330).toEqual(["2026-08-10T05:00:00.000Z", "2026-08-11T05:00:00.000Z"]);

      // 00:30 local on 2026-08-11 is 2026-08-11T05:30:00Z — already "today"
      // (Aug 11) locally, must fall inside the NEXT day's bounds, not the
      // ones above. The naive `${dateStr}T00:00:00Z` bug would instead
      // compute Aug 11's UTC midnight (5h too early), pulling this instant
      // in as "yesterday."
      const at0030Local = new Date("2026-08-11T05:30:00.000Z");
      let bounds0030: [string, string] | null = null;
      await getCompletedItemsToday(
        "user-1",
        at0030Local,
        emptyDataSource({
          getTasksCompletedBetween: async (userId, dayStartIso, dayEndIso) => {
            bounds0030 = [dayStartIso, dayEndIso];
            return [];
          },
        })
      );
      expect(bounds0030).toEqual(["2026-08-11T05:00:00.000Z", "2026-08-12T05:00:00.000Z"]);
    });

    it("returns nothing when nothing was completed today", async () => {
      const items = await getCompletedItemsToday("user-1", now, emptyDataSource());
      expect(items).toEqual([]);
    });
  });
});
