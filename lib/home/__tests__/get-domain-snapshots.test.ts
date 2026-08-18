import { describe, expect, it } from "vitest";
import { getDomainSnapshots, type DomainSnapshotDataSource } from "../get-domain-snapshots";

const CHICAGO_PROFILE = {
  location_lat: 41.8781,
  location_lng: -87.6298,
  timezone: "America/Chicago",
  prayer_calc_method: "MWL" as const,
  asr_madhab: "standard" as const,
  created_at: "2026-01-01T00:00:00Z",
};

const ZERO_PULSE = { deen: 0, business: 0, fitness: 0, school: 0, co_op: 0 };

function baseDataSource(overrides: Partial<DomainSnapshotDataSource> = {}): DomainSnapshotDataSource {
  return {
    getProfile: async () => CHICAGO_PROFILE,
    getPrayers: async () => [],
    getPrayerHistory: async () => [],
    getPrayerHandledCount: async () => 0,
    getQuranSessions: async () => [],
    getQuranWeeklyTarget: async () => null,
    getWeeklyFocusHabit: async () => null,
    getHabitLogDates: async () => [],
    getActiveWorkSession: async () => null,
    getSessionCheckins: async () => [],
    getKillListItems: async () => [],
    getWeeklySnRatio: async () => ({ signal: 0, noise: 0, display: "No data" }),
    getWorkoutSchedule: async () => null,
    getWorkoutLogsThisWeek: async () => [],
    getFitnessHabits: async () => [],
    getFitnessHabitLogs: async () => [],
    getTasksThisWeek: async () => [],
    getDomainPulse: async () => ZERO_PULSE,
    ...overrides,
  };
}

const NOW = new Date("2026-08-10T18:00:00Z"); // 13:00 CDT

describe("getDomainSnapshots", () => {
  describe("deen", () => {
    it("picks the first pending prayer (chronologically) as next, with no due time before others complete", async () => {
      const dataSource = baseDataSource({
        getPrayers: async () => [
          { prayer_name: "fajr", status: "on_time" },
          { prayer_name: "dhuhr", status: "pending" },
        ],
      });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.deen.nextPrayer?.name).toBe("dhuhr");
    });

    it("has no next prayer once every prayer is logged", async () => {
      const dataSource = baseDataSource({
        getPrayers: async () =>
          ["fajr", "dhuhr", "asr", "maghrib", "isha"].map((prayer_name) => ({
            prayer_name,
            status: "on_time",
          })),
      });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.deen.nextPrayer).toBeNull();
    });

    it("sums this week's Qur'an pages read", async () => {
      const dataSource = baseDataSource({
        getQuranSessions: async () => [{ pages_read: 3 }, { pages_read: 5 }],
        getQuranWeeklyTarget: async () => 20,
      });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.deen.quranWeekPages).toBe(8);
      expect(snapshots.deen.quranWeeklyTarget).toBe(20);
    });

    it("includes the current habit-builder focus name and streak when one is set", async () => {
      const dataSource = baseDataSource({
        getWeeklyFocusHabit: async () => ({ id: "habit-1", name: "Read tafsir" }),
        getHabitLogDates: async () => ["2026-08-09", "2026-08-10"],
      });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.deen.habitFocusName).toBe("Read tafsir");
      expect(snapshots.deen.habitFocusStreak).toBe(2);
    });

    it("has a null habit focus when none is set this week", async () => {
      const snapshots = await getDomainSnapshots("user-1", NOW, baseDataSource());
      expect(snapshots.deen.habitFocusName).toBeNull();
      expect(snapshots.deen.habitFocusStreak).toBe(0);
    });

    it("has a zero qada backlog count when no location is set — a null window must never derive missed", async () => {
      const dataSource = baseDataSource({
        getProfile: async () => ({ ...CHICAGO_PROFILE, location_lat: null, location_lng: null }),
      });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.deen.qadaBacklogCount).toBe(0);
    });

    // Old range (<= T-2, provably closed) is derived from a head-only count
    // via getPrayerHandledCount — days*5 minus however many were handled
    // (on_time/qada). No row detail crosses this boundary; see
    // get-domain-snapshots.ts's own comment for why days*5-handled is exact.
    it("derives old-range backlog from the handled head-count when nothing is handled", async () => {
      const dataSource = baseDataSource({ getPrayerHandledCount: async () => 0 });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.deen.qadaBacklogCount).toBeGreaterThan(0);
    });

    it("shrinks the old-range backlog as the handled head-count rises, and clamps at zero rather than going negative", async () => {
      const fewHandled = baseDataSource({ getPrayerHandledCount: async () => 5 });
      const allHandled = baseDataSource({ getPrayerHandledCount: async () => 1_000_000 });

      const fewSnapshot = await getDomainSnapshots("user-1", NOW, fewHandled);
      const allSnapshot = await getDomainSnapshots("user-1", NOW, allHandled);

      expect(allSnapshot.deen.qadaBacklogCount).toBeLessThan(fewSnapshot.deen.qadaBacklogCount);
      expect(allSnapshot.deen.qadaBacklogCount).toBeGreaterThanOrEqual(0);
    });

    // Recent range (T-1, T) still resolves from real per-row history — the
    // one place a window might genuinely still be open, so it can't be
    // reduced to a count. Old-range contribution is pinned to 0 via a
    // saturated handled-count so only the recent-range difference shows.
    it("still resolves the recent range (T-1/T) from real per-row history, distinct from the old range", async () => {
      const nothingLoggedRecently = baseDataSource({
        getPrayerHandledCount: async () => 1_000_000,
        getPrayerHistory: async () => [],
      });
      const allLoggedRecently = baseDataSource({
        getPrayerHandledCount: async () => 1_000_000,
        getPrayerHistory: async () =>
          ["fajr", "dhuhr", "asr", "maghrib", "isha"].flatMap((prayer_name) => [
            { date: "2026-08-09", prayer_name, status: "on_time" },
            { date: "2026-08-10", prayer_name, status: "on_time" },
          ]),
      });

      const nothingSnapshot = await getDomainSnapshots("user-1", NOW, nothingLoggedRecently);
      const allSnapshot = await getDomainSnapshots("user-1", NOW, allLoggedRecently);

      expect(allSnapshot.deen.qadaBacklogCount).toBeLessThan(nothingSnapshot.deen.qadaBacklogCount);
    });
  });

  describe("business", () => {
    it("surfaces the active session's elapsed time and this-session S:N when one is active", async () => {
      const dataSource = baseDataSource({
        getActiveWorkSession: async () => ({ id: "session-1", startedAt: "2026-08-10T17:00:00.000Z" }),
        getSessionCheckins: async () => [
          { tag_type: "kill_list", answered: true },
          { tag_type: "noise", answered: true },
        ],
      });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.business.activeSession).not.toBeNull();
      expect(snapshots.business.activeSession?.elapsedMs).toBe(60 * 60 * 1000);
      expect(snapshots.business.activeSession?.sessionRatioDisplay).toBe("1.0 : 1");
    });

    it("falls back to kill-list completion + weekly ratio when no session is active", async () => {
      const dataSource = baseDataSource({
        getKillListItems: async () => [{ completed: true }, { completed: false }, { completed: true }],
        getWeeklySnRatio: async () => ({ signal: 4, noise: 2, display: "2.0 : 1" }),
      });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.business.activeSession).toBeNull();
      expect(snapshots.business.killListDone).toBe(2);
      expect(snapshots.business.weeklyRatioDisplay).toBe("2.0 : 1");
    });
  });

  describe("fitness", () => {
    it("marks today's scheduled workout as done when a matching log exists", async () => {
      const dataSource = baseDataSource({
        getWorkoutSchedule: async () => ({ workout_name: "Push day", time: null }),
        getWorkoutLogsThisWeek: async () => [{ workout_name: "Push day", date: "2026-08-10" }],
      });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.fitness.scheduledWorkoutName).toBe("Push day");
      expect(snapshots.fitness.workoutDone).toBe(true);
    });

    it("marks it not done when there's no matching log yet today", async () => {
      const dataSource = baseDataSource({
        getWorkoutSchedule: async () => ({ workout_name: "Push day", time: null }),
        getWorkoutLogsThisWeek: async () => [{ workout_name: "Push day", date: "2026-08-08" }],
      });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.fitness.workoutDone).toBe(false);
    });

    it("has a null workout name on a rest day", async () => {
      const snapshots = await getDomainSnapshots("user-1", NOW, baseDataSource());
      expect(snapshots.fitness.scheduledWorkoutName).toBeNull();
    });

    it("counts this week's total logged workouts, independent of today's schedule", async () => {
      const dataSource = baseDataSource({
        getWorkoutLogsThisWeek: async () => [
          { workout_name: "Push day", date: "2026-08-08" },
          { workout_name: "Legs", date: "2026-08-10" },
        ],
      });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.fitness.workoutsThisWeek).toBe(2);
    });
  });

  describe("school / co-op", () => {
    it("counts today's due, incomplete tasks and surfaces the earliest-due title", async () => {
      const dataSource = baseDataSource({
        getTasksThisWeek: async (_userId, domain) =>
          domain === "school"
            ? [
                { id: "t1", title: "Read ch 4", due_date: "2026-08-10", due_time: "14:00", completed: false },
                { id: "t2", title: "Essay draft", due_date: "2026-08-10", due_time: "10:00", completed: false },
                { id: "t3", title: "Already done", due_date: "2026-08-10", due_time: "09:00", completed: true },
              ]
            : [],
      });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.school.dueTodayCount).toBe(2);
      expect(snapshots.school.nextDueTitle).toBe("Essay draft");
    });

    it("is independent per domain (co-op tasks don't leak into school)", async () => {
      const dataSource = baseDataSource({
        getTasksThisWeek: async (_userId, domain) =>
          domain === "co_op"
            ? [{ id: "c1", title: "Bring snacks", due_date: "2026-08-10", due_time: null, completed: false }]
            : [],
      });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.school.dueTodayCount).toBe(0);
      expect(snapshots.co_op.dueTodayCount).toBe(1);
      expect(snapshots.co_op.nextDueTitle).toBe("Bring snacks");
    });

    it("counts this week's completed tasks separately from today's due count", async () => {
      const dataSource = baseDataSource({
        getTasksThisWeek: async (_userId, domain) =>
          domain === "school"
            ? [
                { id: "t1", title: "Read ch 4", due_date: "2026-08-09", due_time: null, completed: true },
                { id: "t2", title: "Essay draft", due_date: "2026-08-10", due_time: "10:00", completed: false },
              ]
            : [],
      });
      const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
      expect(snapshots.school.completedThisWeek).toBe(1);
    });
  });

  it("carries through each domain's getDomainPulse fraction without recomputing it", async () => {
    const dataSource = baseDataSource({
      getDomainPulse: async () => ({ deen: 0.5, business: 0.25, fitness: 1, school: 0, co_op: 0.75 }),
    });
    const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
    expect(snapshots.deen.pulse).toBe(0.5);
    expect(snapshots.business.pulse).toBe(0.25);
    expect(snapshots.fitness.pulse).toBe(1);
    expect(snapshots.school.pulse).toBe(0);
    expect(snapshots.co_op.pulse).toBe(0.75);
  });

  it("carries a null pulse through untouched (nothing tracked today)", async () => {
    const dataSource = baseDataSource({
      getDomainPulse: async () => ({ deen: null, business: null, fitness: null, school: null, co_op: null }),
    });
    const snapshots = await getDomainSnapshots("user-1", NOW, dataSource);
    expect(snapshots.deen.pulse).toBeNull();
    expect(snapshots.co_op.pulse).toBeNull();
  });
});
