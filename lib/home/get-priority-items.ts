import { createClient } from "@/lib/supabase/server";
import { getProfile as getSharedProfile } from "@/lib/supabase/auth";
import type { CalcMethod, AsrMadhab } from "@/lib/prayer-times/calculate";
import { computePrayerWindows, PRAYER_NAMES, type PrayerName } from "@/lib/prayer-times/windows";
import { effectivePrayerStatus, type StoredPrayerStatus } from "@/lib/deen/prayer-status";
import { localDateString, localWeekday, resolveLocalTime, dayOfWeekFromDateString } from "@/lib/date-utils";
import { buildDailyLog, pendingDailyLog, type MicroTotalInput, type MicroFreqInput, type SessionInput } from "@/lib/fitness/daily-log";
import { urgencyBucket } from "./urgency";
import type { PriorityItem, Domain } from "./types";

const DOMAIN_PRIORITY: Record<Domain, number> = {
  deen: 0,
  business: 1,
  school: 2,
  co_op: 2,
  fitness: 3,
};

export type HomeProfile = {
  location_lat: number | null;
  location_lng: number | null;
  timezone: string;
  prayer_calc_method: string;
  asr_madhab: string;
};

export type HomePrayerRow = { id: string; prayer_name: string; status: string };
export type HomeKillListRow = { id: string; text: string; completed: boolean; position: number };
export type HomeTaskRow = {
  id: string;
  domain: "school" | "co_op";
  title: string;
  due_date: string | null;
  due_time: string | null;
  completed: boolean;
};
/**
 * Everything getPriorityItems needs to reconstruct today's DailyLogInputs
 * for the micro/session archetypes only — dailyChecks/bodyMetrics/
 * benchmark are deliberately absent, since Home's fitness row (spec:
 * docs/superpowers/specs/2026-08-23-home-fitness-row.md) never surfaces
 * them. `microPlanName` is the active micro plan's own name (the row's
 * title when micro goals are what's pending) — buildDailyLog's micro
 * items carry exercise names, never the plan's.
 */
export type HomeFitnessData = {
  microPlanName: string | null;
  microTotals: MicroTotalInput[];
  microFreqs: MicroFreqInput[];
  sessions: SessionInput[];
};

export type HomeDataSource = {
  getProfile: (userId: string) => Promise<HomeProfile | null>;
  getPrayers: (userId: string, date: string) => Promise<HomePrayerRow[]>;
  getKillListItems: (userId: string, date: string) => Promise<HomeKillListRow[]>;
  getTasks: (userId: string, date: string) => Promise<HomeTaskRow[]>;
  getFitness: (userId: string, date: string, dayOfWeek: number) => Promise<HomeFitnessData>;
};

// Exported for testing defaultDataSource().getProfile() in isolation — see
// lib/home/__tests__/default-data-source.test.ts. Real callers always use
// the default parameter value in getPriorityItems()/getTodayDateString().
export function defaultDataSource(): HomeDataSource {
  return {
    // Routes through the shared, cache()-per-request getProfile() (see
    // lib/supabase/auth.ts) instead of its own raw query — this used to be
    // a separate, un-deduped profiles read on every Home load, on top of
    // the one layout.tsx/page.tsx already do. Narrows the full row down to
    // just the fields HomeProfile needs (never pass pin_hash or other
    // fields through further than necessary).
    async getProfile(_userId) {
      const profile = await getSharedProfile();
      if (!profile) return null;
      return {
        location_lat: profile.location_lat,
        location_lng: profile.location_lng,
        timezone: profile.timezone,
        prayer_calc_method: profile.prayer_calc_method,
        asr_madhab: profile.asr_madhab,
      };
    },
    async getPrayers(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("prayers")
        .select("id, prayer_name, status")
        .eq("user_id", userId)
        .eq("date", date);
      return data ?? [];
    },
    async getKillListItems(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("kill_list_items")
        .select("id, text, completed, position")
        .eq("user_id", userId)
        .eq("date", date)
        .order("position", { ascending: true });
      return data ?? [];
    },
    async getTasks(userId, date) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("tasks")
        .select("id, domain, title, due_date, due_time, completed")
        .eq("user_id", userId)
        .eq("due_date", date);
      return (data ?? []) as HomeTaskRow[];
    },
    async getFitness(userId, date, dayOfWeek) {
      const supabase = await createClient();
      const empty: HomeFitnessData = { microPlanName: null, microTotals: [], microFreqs: [], sessions: [] };

      const { data: activeRow } = await supabase
        .from("active_workout_plans")
        .select("micro_plan_id, routine_plan_id")
        .eq("user_id", userId)
        .maybeSingle();
      const microPlanId = activeRow?.micro_plan_id ?? null;
      const routinePlanId = activeRow?.routine_plan_id ?? null;
      if (!microPlanId && !routinePlanId) return empty;

      const [microPlanResult, microExerciseResult, todaySetsResult, sessionResult, confirmedResult] = await Promise.all([
        microPlanId
          ? supabase.from("workout_plans").select("name").eq("id", microPlanId).maybeSingle()
          : Promise.resolve({ data: null }),
        microPlanId
          ? supabase
              .from("plan_micro_exercises")
              .select("exercise_id, schedule_days, goal_type, goal_value, notes, exercises(name)")
              .eq("plan_id", microPlanId)
          : Promise.resolve({ data: [] }),
        microPlanId
          ? supabase
              .from("session_sets")
              .select("exercise_id, sets, reps, workout_sessions!inner(date, user_id)")
              .eq("workout_sessions.user_id", userId)
              .eq("workout_sessions.date", date)
          : Promise.resolve({ data: [] }),
        routinePlanId
          ? supabase
              .from("plan_sessions")
              .select("id, name, schedule_days, start_time, plan_session_exercises(duration_minutes)")
              .eq("plan_id", routinePlanId)
          : Promise.resolve({ data: [] }),
        routinePlanId
          ? supabase
              .from("workout_sessions")
              .select("plan_session_id")
              .eq("user_id", userId)
              .eq("date", date)
              .eq("source", "confirmed")
              .not("plan_session_id", "is", null)
          : Promise.resolve({ data: [] }),
      ]);

      const totalByExercise = new Map<string, number>();
      const boutsByExercise = new Map<string, number>();
      for (const row of todaySetsResult.data ?? []) {
        if (!row.exercise_id) continue;
        totalByExercise.set(row.exercise_id, (totalByExercise.get(row.exercise_id) ?? 0) + row.sets * row.reps);
        boutsByExercise.set(row.exercise_id, (boutsByExercise.get(row.exercise_id) ?? 0) + 1);
      }

      const microToday = (microExerciseResult.data ?? []).filter((e) => e.schedule_days.includes(dayOfWeek));
      const microTotals: MicroTotalInput[] = microToday
        .filter((e) => e.goal_type === "daily_total")
        .map((e) => ({
          exerciseId: e.exercise_id,
          name: e.exercises?.name ?? "",
          target: e.goal_value,
          loggedToday: totalByExercise.get(e.exercise_id) ?? 0,
          notes: e.notes,
        }));
      const microFreqs: MicroFreqInput[] = microToday
        .filter((e) => e.goal_type === "frequency")
        .map((e) => ({
          exerciseId: e.exercise_id,
          name: e.exercises?.name ?? "",
          target: e.goal_value,
          boutsToday: boutsByExercise.get(e.exercise_id) ?? 0,
          notes: e.notes,
        }));

      const confirmedSessionIds = new Set((confirmedResult.data ?? []).map((r) => r.plan_session_id));
      const sessions: SessionInput[] = (sessionResult.data ?? [])
        .filter((s) => s.schedule_days.includes(dayOfWeek))
        .map((s) => ({
          sessionId: s.id,
          name: s.name,
          durationMinutes: (s.plan_session_exercises ?? []).reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0),
          startTime: s.start_time,
          confirmedToday: confirmedSessionIds.has(s.id),
        }));

      return { microPlanName: microPlanResult.data?.name ?? null, microTotals, microFreqs, sessions };
    },
  };
}

export async function getPriorityItems(
  userId: string,
  now: Date,
  dataSource: HomeDataSource = defaultDataSource()
): Promise<PriorityItem[]> {
  const profile = await dataSource.getProfile(userId);
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);

  const dayOfWeek = dayOfWeekFromDateString(dateStr);
  const [prayerRows, killListRows, taskRows, fitnessData] = await Promise.all([
    dataSource.getPrayers(userId, dateStr),
    dataSource.getKillListItems(userId, dateStr),
    dataSource.getTasks(userId, dateStr),
    dataSource.getFitness(userId, dateStr, dayOfWeek),
  ]);

  const items: Omit<PriorityItem, "date">[] = [];

  // Deen: prayers — windowed, not instants. A prayer is actionable here when
  // its window is currently open ("pending"), or when it's coming up within
  // the same right-now lookahead every other domain's due-soon item gets
  // ("upcoming" + urgencyBucket already says right_now). A prayer whose
  // window has closed ("missed") is no longer shown here at all — it flows
  // into the Qada backlog instead, not Home's due-today list.
  let windows: Record<PrayerName, { start: Date; end: Date } | null> | null = null;
  if (profile?.location_lat != null && profile?.location_lng != null) {
    windows = computePrayerWindows({
      date: now,
      lat: profile.location_lat,
      lng: profile.location_lng,
      timezone,
      calcMethod: (profile.prayer_calc_method as CalcMethod) || "MWL",
      asrMadhab: (profile.asr_madhab as AsrMadhab) || "standard",
    });
  }

  const isFriday = localWeekday(now, timezone) === "Friday";
  for (const prayerName of PRAYER_NAMES) {
    const row = prayerRows.find((p) => p.prayer_name === prayerName);
    const stored = (row?.status as StoredPrayerStatus | undefined) ?? null;
    const window = windows ? windows[prayerName] : null;
    const effective = effectivePrayerStatus(stored, window, now);
    const dueAt = window ? window.start : null;
    const bucket = dueAt ? urgencyBucket(dueAt, now) : "later_today";
    const isActionableSoon = effective === "upcoming" && bucket === "right_now";
    if (effective !== "pending" && !isActionableSoon) continue;

    const title = prayerName === "dhuhr" && isFriday
      ? "Jummah"
      : prayerName.charAt(0).toUpperCase() + prayerName.slice(1);

    items.push({
      id: `prayer-${prayerName}`,
      domain: "deen",
      title,
      dueAt,
      windowEndAt: window ? window.end : null,
      urgencyBucket: bucket,
      completed: false,
      actionType: "toggle_prayer",
      actionRefId: prayerName,
    });
  }

  // Business: kill list, rolled into a single item per spec
  const incompleteKillList = killListRows.filter((k) => !k.completed);
  if (incompleteKillList.length > 0) {
    const next = incompleteKillList[0];
    items.push({
      id: "kill-list",
      domain: "business",
      title:
        incompleteKillList.length === 1
          ? next.text
          : `${incompleteKillList.length} kill-list items remaining`,
      dueAt: null,
      windowEndAt: null,
      urgencyBucket: "later_today",
      completed: false,
      actionType: "toggle_kill_list",
      actionRefId: next.id,
    });
  }

  // School / Work: tasks due today
  for (const task of taskRows) {
    if (task.completed || !task.due_date) continue;
    const dueAt = task.due_time ? resolveLocalTime(task.due_date, task.due_time, timezone) : null;
    items.push({
      id: `task-${task.id}`,
      domain: task.domain,
      title: task.title,
      dueAt,
      windowEndAt: null,
      urgencyBucket: urgencyBucket(dueAt, now),
      completed: false,
      actionType: "toggle_task",
      actionRefId: task.id,
    });
  }

  // Fitness: at most one row, naming today's workout — never a bare
  // complete-with-one-tap item (fitness spec §2.1 forbids blind
  // confirmation, and rep goals aren't binary anyway). Reuses
  // buildDailyLog/pendingDailyLog (lib/fitness/daily-log.ts) rather than
  // re-deriving "is today's workout done" here — a second implementation
  // would drift from the Fitness screen and the two surfaces would
  // disagree about whether the day is complete (docs/superpowers/specs/
  // 2026-08-23-home-fitness-row.md). dailyChecks/bodyMetrics/benchmark are
  // deliberately omitted — those are Fitness-screen concerns, not part of
  // "the workout's name." A scheduled, unconfirmed SESSION outranks micro
  // goals (the larger, fixed-shape commitment); title is never both/
  // concatenated.
  const fitnessPending = pendingDailyLog(
    buildDailyLog({
      microTotals: fitnessData.microTotals,
      microFreqs: fitnessData.microFreqs,
      sessions: fitnessData.sessions,
      dailyChecks: [],
      bodyMetrics: [],
      benchmark: null,
    })
  );
  const pendingSession = fitnessPending.find((i) => i.kind === "session");
  const hasPendingMicro = fitnessPending.some((i) => i.kind === "micro_total" || i.kind === "micro_freq");
  const fitnessTitle = pendingSession ? pendingSession.name : hasPendingMicro ? fitnessData.microPlanName : null;
  if (fitnessTitle) {
    items.push({
      id: "fitness-today",
      domain: "fitness",
      title: fitnessTitle,
      dueAt: null,
      windowEndAt: null,
      urgencyBucket: "later_today",
      completed: false,
      actionType: "open_fitness",
      actionRefId: pendingSession ? pendingSession.sessionId : "micro",
    });
  }

  items.sort((a, b) => {
    if (a.urgencyBucket !== b.urgencyBucket) {
      return a.urgencyBucket === "right_now" ? -1 : 1;
    }
    const aTime = a.dueAt?.getTime() ?? Infinity;
    const bTime = b.dueAt?.getTime() ?? Infinity;
    if (aTime !== bTime) return aTime - bTime;
    return DOMAIN_PRIORITY[a.domain] - DOMAIN_PRIORITY[b.domain];
  });

  return items.map((item) => ({ ...item, date: dateStr }));
}

/**
 * Today's YYYY-MM-DD in the user's profile timezone — for callers (e.g. the
 * domain pulse rings) that need "today" independent of whether any
 * PriorityItem exists to read `.date` off of (the empty/all-clear state).
 */
export async function getTodayDateString(
  userId: string,
  now: Date,
  dataSource: Pick<HomeDataSource, "getProfile"> = defaultDataSource()
): Promise<string> {
  const profile = await dataSource.getProfile(userId);
  return localDateString(now, profile?.timezone ?? "UTC");
}
