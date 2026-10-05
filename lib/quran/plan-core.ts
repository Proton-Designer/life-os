import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateString, getWeekStartDate } from "@/lib/date-utils";
import { JUZ_START_PAGES, TOTAL_PAGES, juzForPage, surahLabelForSpan } from "@/lib/quran/page-map";
import {
  DEFAULT_PRESET,
  applyReading,
  cumulativeTargetPages,
  isPlanSetupError,
  keepDateBaseline,
  khatmPercent,
  moveDateBaseline,
  pausedSpanDays,
  planPace,
  planSetupFor,
  planStatus,
  readingDaysInLast7,
  recentPace,
  todaysPortion,
  type PlanStatus,
  type Portion,
  type QuranPlanParams,
  type QuranPlanPreset,
  type ReadingLog,
} from "@/lib/quran/plan";

/**
 * QURAN-01: reads/writes of the khatm plan (quran_plans, migration 258) and its reading log (quran_sessions). No auth,
 * profile or Deen-gate lookups in here (same core rule as lib/deen/actions-core.ts): the Server Actions
 * (app/(app)/deen/quran-plan-actions.ts) and the MCP twins gate on Deen Mode, resolve the user's LOCAL date and pass it in.
 * Writes are absolute; the bookmark moves only through a guarded UPDATE on the page it was read at, so a double tap or two
 * devices can never apply the same log twice.
 */

type PlanRow = {
  id: string;
  khatm_number: number;
  start_date: string;
  start_page: number;
  plan_set_on: string;
  plan_set_page: number;
  target_date: string | null;
  pace_pages_per_day: number | null;
  original_pace_pages_per_day: number;
  current_page: number;
  status: string;
  paused_on: string | null;
  paused_days: number;
  completed_on: string | null;
};

const PLAN_COLUMNS =
  "id, khatm_number, start_date, start_page, plan_set_on, plan_set_page, target_date, pace_pages_per_day, original_pace_pages_per_day, current_page, status, paused_on, paused_days, completed_on";

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

export function rowToPlan(row: PlanRow): QuranPlanParams & { id: string; khatmNumber: number; completedOn: string | null } {
  return {
    id: row.id,
    khatmNumber: row.khatm_number,
    startDate: row.start_date,
    startPage: row.start_page,
    planSetOn: row.plan_set_on,
    planSetPage: row.plan_set_page,
    targetDate: row.target_date,
    pacePagesPerDay: row.pace_pages_per_day === null ? null : num(row.pace_pages_per_day),
    originalPacePagesPerDay: num(row.original_pace_pages_per_day),
    currentPage: row.current_page,
    status: row.status as QuranPlanParams["status"],
    pausedOn: row.paused_on,
    pausedDays: row.paused_days,
    completedOn: row.completed_on,
  };
}

export type StoredPlan = ReturnType<typeof rowToPlan>;

/** The user's open (active or paused) plan, else null. */
export async function getOpenPlanCore(supabase: SupabaseClient, userId: string): Promise<StoredPlan | null> {
  const { data, error } = await supabase.from("quran_plans").select(PLAN_COLUMNS).eq("user_id", userId).in("status", ["active", "paused"]).maybeSingle();
  if (error) throw error;
  return data ? rowToPlan(data as PlanRow) : null;
}

/** The most recent plan of any status (the open one, else the last finished khatm). */
export async function getLatestPlanCore(supabase: SupabaseClient, userId: string): Promise<StoredPlan | null> {
  const { data, error } = await supabase.from("quran_plans").select(PLAN_COLUMNS).eq("user_id", userId).order("khatm_number", { ascending: false }).limit(1);
  if (error) throw error;
  const row = (data ?? [])[0];
  return row ? rowToPlan(row as PlanRow) : null;
}

export type OverviewSession = { date: string; pages: number };

async function recentSessions(supabase: SupabaseClient, userId: string, sinceDate: string): Promise<OverviewSession[]> {
  const { data, error } = await supabase.from("quran_sessions").select("date, pages_read").eq("user_id", userId).gte("date", sinceDate);
  if (error) throw error;
  return (data ?? []).map((r) => ({ date: r.date as string, pages: r.pages_read as number }));
}

export type QuranOverview = {
  /** The open plan, else the last finished khatm, else null (no plan yet). */
  plan: {
    id: string;
    khatmNumber: number;
    status: QuranPlanParams["status"];
    currentPage: number;
    startPage: number;
    startDate: string;
    /** The finish day including paused days. */
    targetDate: string;
    completedOn: string | null;
    percent: number;
    pagesLeft: number;
    pacePagesPerDay: number;
  } | null;
  /** Today's portion with its labels (null when paused / finished / no plan). */
  portion: (Portion & { surahLabel: string; juz: number }) | null;
  status: PlanStatus | null;
  /** "5 of the last 7 days": distinct reading days, no streaks. */
  readingDaysLast7: number;
  /** Pages read this local week (Sun-Sat, every quran_sessions row) vs what the plan asked for so far this week. */
  week: { pagesRead: number; plannedToDate: number; weeklyTargetPages: number | null };
  /** Pages the user read TODAY (any log). */
  pagesReadToday: number;
  juz: { current: number; completed: number };
};

const EMPTY_WEEK = { pagesRead: 0, plannedToDate: 0, weeklyTargetPages: null };

/** Everything the Deen card / Home / close / weekly reset need, in one read (two small queries). */
export async function getQuranOverviewCore(supabase: SupabaseClient, userId: string, localDate: string): Promise<QuranOverview> {
  const weekStart = getWeekStartDate(localDate);
  const sessions = await recentSessions(supabase, userId, weekStart < addDaysToDateString(localDate, -13) ? weekStart : addDaysToDateString(localDate, -13));
  const pagesReadToday = sessions.filter((s) => s.date === localDate).reduce((n, s) => n + s.pages, 0);
  const weekPagesRead = sessions.filter((s) => s.date >= weekStart && s.date <= localDate).reduce((n, s) => n + s.pages, 0);

  const plan = (await getOpenPlanCore(supabase, userId)) ?? (await getLatestPlanCore(supabase, userId));
  if (!plan) {
    return { plan: null, portion: null, status: null, readingDaysLast7: readingDaysInLast7(sessions, localDate), week: { ...EMPTY_WEEK, pagesRead: weekPagesRead }, pagesReadToday, juz: { current: 1, completed: 0 } };
  }

  const pace = planPace(plan);
  const recent = recentPace(sessions, localDate, plan.planSetOn, pace);
  const status = planStatus(plan, localDate, recent);
  const rawPortion = todaysPortion(plan, localDate);
  const portion = rawPortion ? { ...rawPortion, surahLabel: surahLabelForSpan(rawPortion.from, rawPortion.to), juz: juzForPage(rawPortion.from) } : null;

  const active = plan.status === "active";
  const plannedToDate = active
    ? Math.max(0, cumulativeTargetPages(plan, localDate) - cumulativeTargetPages(plan, addDaysToDateString(weekStart, -1)))
    : 0;
  const current = Math.min(TOTAL_PAGES, plan.currentPage);
  const completedJuz = JUZ_START_PAGES.filter((start, i) => (i + 1 < 30 ? JUZ_START_PAGES[i + 1] <= plan.currentPage : plan.currentPage > TOTAL_PAGES)).length;

  return {
    plan: {
      id: plan.id,
      khatmNumber: plan.khatmNumber,
      status: plan.status,
      currentPage: plan.currentPage,
      startPage: plan.startPage,
      startDate: plan.startDate,
      targetDate: status.effectiveTargetDate,
      completedOn: plan.completedOn,
      percent: khatmPercent(plan.currentPage),
      pagesLeft: status.pagesLeft,
      pacePagesPerDay: Math.round(pace * 100) / 100,
    },
    portion,
    status,
    readingDaysLast7: readingDaysInLast7(sessions, localDate),
    week: { pagesRead: weekPagesRead, plannedToDate, weeklyTargetPages: active ? Math.round(pace * 7) : null },
    pagesReadToday,
    juz: { current: juzForPage(current), completed: completedJuz },
  };
}

/**
 * The Deen weekly goal's Quran page target while a plan is ACTIVE (daily pace x 7), else null: callers fall back to the
 * manually typed deen_weekly_goals.quran_page_target when there is no active plan.
 */
export function derivedWeeklyQuranTarget(overview: Pick<QuranOverview, "week" | "plan">): number | null {
  return overview.plan?.status === "active" ? overview.week.weeklyTargetPages : null;
}

// ----------------------------------------------------------------------------------------------------------------
// Writes. Every one returns { ok:false, message } for expected refusals (never a throw for user input).

export type CoreResult<T = unknown> = ({ ok: true } & T) | { ok: false; message: string };

export type StartPlanInput = { preset?: QuranPlanPreset; startFrom?: "beginning" | "current_page"; startPage?: number };

/** Creates the user's plan (one open plan at a time); the default preset is "Finish in 60 days" from page 1. */
export async function startQuranPlanCore(supabase: SupabaseClient, userId: string, localDate: string, input: StartPlanInput = {}): Promise<CoreResult<{ planId: string; khatmNumber: number }>> {
  if (await getOpenPlanCore(supabase, userId)) return { ok: false, message: "You already have a Quran plan. Finish or edit it first." };
  const startPage = input.startPage ?? 1;
  const setup = planSetupFor(input.preset ?? DEFAULT_PRESET, localDate, startPage);
  if (isPlanSetupError(setup)) return { ok: false, message: setup.error };
  const latest = await getLatestPlanCore(supabase, userId);
  const khatmNumber = (latest?.khatmNumber ?? 0) + 1;
  const { data, error } = await supabase
    .from("quran_plans")
    .insert({
      user_id: userId,
      khatm_number: khatmNumber,
      start_date: localDate,
      start_page: startPage,
      plan_set_on: localDate,
      plan_set_page: startPage,
      target_date: setup.targetDate,
      pace_pages_per_day: setup.pacePagesPerDay,
      original_pace_pages_per_day: setup.originalPacePagesPerDay,
      current_page: startPage,
      status: "active",
    })
    .select("id")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return { ok: false, message: "You already have a Quran plan." };
    throw error;
  }
  return { ok: true, planId: data.id as string, khatmNumber };
}

/** Starts the next khatm at the same pace as the one just finished (page 1, today). */
export async function startNextKhatmCore(supabase: SupabaseClient, userId: string, localDate: string): Promise<CoreResult<{ planId: string; khatmNumber: number }>> {
  if (await getOpenPlanCore(supabase, userId)) return { ok: false, message: "Finish your current khatm first." };
  const latest = await getLatestPlanCore(supabase, userId);
  if (!latest || latest.status !== "completed") return { ok: false, message: "There is no finished khatm to follow." };
  return startQuranPlanCore(supabase, userId, localDate, { preset: { kind: "custom_pace", pagesPerDay: latest.originalPacePagesPerDay }, startPage: 1 });
}

export type LogReadingInput = { toPage: number } | { nextPage: number } | { todaysPortion: true };
export type LogReadingResult = { sessionId: string; pagesRead: number; fromPage: number; toPage: number; newCurrentPage: number; juzCompleted: number[]; khatmComplete: boolean; date: string };

/**
 * Logs reading toward the open plan. `toPage` = the last page read; `nextPage` = "I'm on page N" (= toPage N-1);
 * `todaysPortion` = read through today's portion. `forDate` 'yesterday' files the reading under yesterday.
 */
export async function logQuranReadingCore(
  supabase: SupabaseClient,
  userId: string,
  localDate: string,
  input: LogReadingInput,
  forDate: "today" | "yesterday" = "today"
): Promise<CoreResult<LogReadingResult>> {
  const plan = await getOpenPlanCore(supabase, userId);
  if (!plan) return { ok: false, message: "Start a Quran plan first." };
  if (plan.status === "paused") return { ok: false, message: "Your plan is paused. Resume it to log reading." };

  let toPage: number;
  if ("todaysPortion" in input) {
    const portion = todaysPortion(plan, localDate);
    if (!portion) return { ok: false, message: "There is no portion to log today." };
    toPage = portion.to;
  } else if ("nextPage" in input) {
    toPage = input.nextPage - 1;
  } else {
    toPage = input.toPage;
  }

  const date = forDate === "yesterday" ? addDaysToDateString(localDate, -1) : localDate;
  if (date < plan.startDate) return { ok: false, message: "That day is before your plan started." };

  const log = applyReading(plan.currentPage, toPage);
  if ("error" in log) return { ok: false, message: log.error };
  return commitLog(supabase, userId, plan, log, date, localDate);
}

async function commitLog(supabase: SupabaseClient, userId: string, plan: StoredPlan, log: ReadingLog, date: string, localDate: string): Promise<CoreResult<LogReadingResult>> {
  // 1) Move the bookmark, guarded on the page it was read at: a concurrent log changes current_page and matches 0 rows.
  const planPatch: Record<string, unknown> = { current_page: log.newCurrentPage };
  if (log.khatmComplete) Object.assign(planPatch, { status: "completed", completed_on: localDate });
  const { data: moved, error: moveError } = await supabase.from("quran_plans").update(planPatch).eq("id", plan.id).eq("user_id", userId).eq("current_page", plan.currentPage).select("id");
  if (moveError) throw moveError;
  if (!moved || moved.length === 0) return { ok: false, message: "Your bookmark just changed on another device. Refresh and try again." };

  // 2) The log row (legacy columns surah/juz/pages_read stay filled so every existing Quran reader keeps working).
  const { data: session, error: sessionError } = await supabase
    .from("quran_sessions")
    .insert({
      user_id: userId,
      date,
      pages_read: log.pagesRead,
      surah: surahLabelForSpan(log.fromPage, log.toPage),
      juz: juzForPage(log.fromPage),
      from_page: log.fromPage,
      to_page: log.toPage,
      plan_id: plan.id,
    })
    .select("id")
    .single();
  if (sessionError) {
    // Put the bookmark back (guarded the same way) rather than leave a page counted with no log.
    await supabase.from("quran_plans").update({ current_page: plan.currentPage, status: "active", completed_on: null }).eq("id", plan.id).eq("user_id", userId).eq("current_page", log.newCurrentPage);
    throw sessionError;
  }
  return { ok: true, sessionId: session.id as string, pagesRead: log.pagesRead, fromPage: log.fromPage, toPage: log.toPage, newCurrentPage: log.newCurrentPage, juzCompleted: log.juzCompleted, khatmComplete: log.khatmComplete, date };
}

/** Undoes the most recent log of the latest plan: deletes that session and puts the bookmark back to where it started. */
export async function undoLastQuranLogCore(supabase: SupabaseClient, userId: string): Promise<CoreResult<{ currentPage: number }>> {
  const plan = await getLatestPlanCore(supabase, userId);
  if (!plan) return { ok: false, message: "Nothing to undo." };
  const { data, error } = await supabase
    .from("quran_sessions")
    .select("id, from_page, to_page")
    .eq("user_id", userId)
    .eq("plan_id", plan.id)
    .not("from_page", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const last = (data ?? [])[0] as { id: string; from_page: number; to_page: number } | undefined;
  if (!last) return { ok: false, message: "Nothing to undo." };
  // Only the log the bookmark currently sits right after can be undone (a bookmark edit since then makes it ambiguous).
  if (last.to_page + 1 !== plan.currentPage) return { ok: false, message: "You've moved your bookmark since that log, so it can't be undone." };

  const { data: moved, error: moveError } = await supabase
    .from("quran_plans")
    .update({ current_page: last.from_page, status: "active", completed_on: null })
    .eq("id", plan.id)
    .eq("user_id", userId)
    .eq("current_page", plan.currentPage)
    .select("id");
  if (moveError) {
    if ((moveError as { code?: string }).code === "23505") return { ok: false, message: "You've started another plan since, so that khatm can't be reopened." };
    throw moveError;
  }
  if (!moved || moved.length === 0) return { ok: false, message: "Your bookmark just changed on another device. Refresh and try again." };
  const { error: deleteError } = await supabase.from("quran_sessions").delete().eq("id", last.id).eq("user_id", userId);
  if (deleteError) throw deleteError;
  return { ok: true, currentPage: last.from_page };
}

/** Absolute bookmark edit (can go back, unlike a log): the NEXT page to read, 1..604. No log row is written. */
export async function setQuranBookmarkCore(supabase: SupabaseClient, userId: string, page: number): Promise<CoreResult<{ currentPage: number }>> {
  if (!Number.isInteger(page) || page < 1 || page > TOTAL_PAGES) return { ok: false, message: `Page must be between 1 and ${TOTAL_PAGES}.` };
  const plan = await getOpenPlanCore(supabase, userId);
  if (!plan) return { ok: false, message: "Start a Quran plan first." };
  const { data, error } = await supabase.from("quran_plans").update({ current_page: page }).eq("id", plan.id).eq("user_id", userId).select("id");
  if (error) throw error;
  if (!data || data.length === 0) return { ok: false, message: "Couldn't update the bookmark." };
  return { ok: true, currentPage: page };
}

/** "Keep the date" (newDate null: same finish day, remaining pages re-spread from today) or "Move the date" (a new finish day). */
export async function keepOrMoveFinishDateCore(supabase: SupabaseClient, userId: string, localDate: string, newDate: string | null): Promise<CoreResult<{ targetDate: string }>> {
  const plan = await getOpenPlanCore(supabase, userId);
  if (!plan) return { ok: false, message: "Start a Quran plan first." };
  if (plan.status === "paused") return { ok: false, message: "Resume your plan first." };
  const baseline = newDate === null ? keepDateBaseline(plan, localDate) : moveDateBaseline(plan, localDate, newDate);
  if ("error" in baseline) return { ok: false, message: baseline.error };
  const { data, error } = await supabase
    .from("quran_plans")
    .update({ plan_set_on: baseline.planSetOn, plan_set_page: baseline.planSetPage, target_date: baseline.targetDate, pace_pages_per_day: baseline.pacePagesPerDay, paused_days: baseline.pausedDays })
    .eq("id", plan.id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) return { ok: false, message: "Couldn't update the plan." };
  return { ok: true, targetDate: baseline.targetDate! };
}

export async function pauseQuranPlanCore(supabase: SupabaseClient, userId: string, localDate: string): Promise<CoreResult> {
  const plan = await getOpenPlanCore(supabase, userId);
  if (!plan) return { ok: false, message: "Start a Quran plan first." };
  if (plan.status === "paused") return { ok: true }; // absolute: already paused
  const { data, error } = await supabase.from("quran_plans").update({ status: "paused", paused_on: localDate }).eq("id", plan.id).eq("user_id", userId).eq("status", "active").select("id");
  if (error) throw error;
  if (!data || data.length === 0) return { ok: false, message: "Couldn't pause the plan." };
  return { ok: true };
}

export async function resumeQuranPlanCore(supabase: SupabaseClient, userId: string, localDate: string): Promise<CoreResult> {
  const plan = await getOpenPlanCore(supabase, userId);
  if (!plan) return { ok: false, message: "Start a Quran plan first." };
  if (plan.status === "active") return { ok: true }; // absolute: already running
  const frozen = plan.pausedOn ? pausedSpanDays(plan.pausedOn, localDate) : 0;
  const { data, error } = await supabase
    .from("quran_plans")
    .update({ status: "active", paused_on: null, paused_days: plan.pausedDays + frozen })
    .eq("id", plan.id)
    .eq("user_id", userId)
    .eq("status", "paused")
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) return { ok: false, message: "Couldn't resume the plan." };
  return { ok: true };
}

