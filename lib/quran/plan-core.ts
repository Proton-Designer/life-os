import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateString, getWeekStartDate } from "@/lib/date-utils";
import { ramadanWindow } from "@/lib/quran/ramadan";
import { JUZ_START_PAGES, TOTAL_PAGES, juzForPage, surahLabelForSpan } from "@/lib/quran/page-map";
import { pageOfAyah } from "@/lib/quran/ayah-map";
import {
  editEntry,
  ledgerBookmark,
  ledgerGaps,
  lastSavedEntry,
  NEW_ENTRY_ID,
  removeEntry,
  resolveLog,
  trimLedgerTo,
  type LedgerContext,
  type LedgerEntry,
  type LogMethod,
  type EntryPatch,
  type PageGap,
} from "@/lib/quran/ledger";
import {
  DEFAULT_PRESET,
  juzCompletedBetween,
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
  current_ayah: number | null;
  status: string;
  paused_on: string | null;
  paused_days: number;
  completed_on: string | null;
};

const PLAN_COLUMNS =
  "id, khatm_number, start_date, start_page, plan_set_on, plan_set_page, target_date, pace_pages_per_day, original_pace_pages_per_day, current_page, current_ayah, status, paused_on, paused_days, completed_on";

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

export function rowToPlan(row: PlanRow): QuranPlanParams & { id: string; khatmNumber: number; completedOn: string | null; currentAyah: number | null } {
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
    currentAyah: row.current_ayah ?? null,
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

export type OverviewSession = { date: string; pages: number; /** The span a plan log covered (null on legacy rows). */ fromPage: number | null; toPage: number | null };

async function recentSessions(supabase: SupabaseClient, userId: string, sinceDate: string): Promise<OverviewSession[]> {
  const { data, error } = await supabase.from("quran_sessions").select("date, pages_read, from_page, to_page").eq("user_id", userId).gte("date", sinceDate);
  if (error) throw error;
  return (data ?? []).map((r) => ({ date: r.date as string, pages: r.pages_read as number, fromPage: (r.from_page as number | null) ?? null, toPage: (r.to_page as number | null) ?? null }));
}

export type QuranOverview = {
  /** The open plan, else the last finished khatm, else null (no plan yet). */
  plan: {
    id: string;
    khatmNumber: number;
    status: QuranPlanParams["status"];
    currentPage: number;
    /** The exact ayah (global number 1..6236) the reader is on inside currentPage, or null = the top of the page. */
    currentAyah: number | null;
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
  portion: (Portion & { surahLabel: string; /** The juz of the first page (kept for older callers). */ juz: number; juzFrom: number; juzTo: number }) | null;
  status: PlanStatus | null;
  /** "5 of the last 7 days": distinct reading days, no streaks. */
  readingDaysLast7: number;
  /** Pages read this local week (Sun-Sat, every quran_sessions row) vs what the plan asked for so far this week. */
  week: { pagesRead: number; plannedToDate: number; weeklyTargetPages: number | null };
  /** Pages the user read TODAY (any log). */
  pagesReadToday: number;
  /** Pages read on each of the last 14 days, oldest first, ending today (every quran_sessions row). */
  daily: { date: string; pages: number }[];
  juz: {
    current: number;
    completed: number;
    /** Juz whose last page a log filed under TODAY crossed (server-driven "Juz 7 complete · 7 of 30" note); [] otherwise. */
    completedToday: number[];
  };
};

/** Juz completed by the plan logs filed under `localDate` (a log from page a through b completes every juz ending in [a, b]). */
export function juzCompletedToday(sessions: ReadonlyArray<OverviewSession>, localDate: string): number[] {
  const done = new Set<number>();
  for (const s of sessions) {
    if (s.date !== localDate || s.fromPage === null || s.toPage === null) continue;
    for (const j of juzCompletedBetween(s.fromPage, s.toPage + 1)) done.add(j);
  }
  return [...done].sort((a, b) => a - b);
}

const EMPTY_WEEK = { pagesRead: 0, plannedToDate: 0, weeklyTargetPages: null };

/** Everything the Deen card / Home / close / weekly reset need, in one read (two small queries). */
export async function getQuranOverviewCore(supabase: SupabaseClient, userId: string, localDate: string): Promise<QuranOverview> {
  const weekStart = getWeekStartDate(localDate);
  const sessions = await recentSessions(supabase, userId, weekStart < addDaysToDateString(localDate, -13) ? weekStart : addDaysToDateString(localDate, -13));
  const pagesReadToday = sessions.filter((s) => s.date === localDate).reduce((n, s) => n + s.pages, 0);
  const weekPagesRead = sessions.filter((s) => s.date >= weekStart && s.date <= localDate).reduce((n, s) => n + s.pages, 0);

  const daily = Array.from({ length: 14 }, (_, i) => {
    const date = addDaysToDateString(localDate, i - 13);
    return { date, pages: sessions.filter((s) => s.date === date).reduce((n, s) => n + s.pages, 0) };
  });

  const plan = (await getOpenPlanCore(supabase, userId)) ?? (await getLatestPlanCore(supabase, userId));
  if (!plan) {
    return { plan: null, portion: null, status: null, readingDaysLast7: readingDaysInLast7(sessions, localDate), week: { ...EMPTY_WEEK, pagesRead: weekPagesRead }, pagesReadToday, daily, juz: { current: 1, completed: 0, completedToday: [] } };
  }

  const pace = planPace(plan);
  const recent = recentPace(sessions, localDate, plan.planSetOn, pace);
  const status = planStatus(plan, localDate, recent);
  const rawPortion = todaysPortion(plan, localDate);
  const portion = rawPortion ? { ...rawPortion, surahLabel: surahLabelForSpan(rawPortion.from, rawPortion.to), juz: juzForPage(rawPortion.from), juzFrom: juzForPage(rawPortion.from), juzTo: juzForPage(rawPortion.to) } : null;

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
      currentAyah: plan.currentAyah,
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
    daily,
    juz: { current: juzForPage(current), completed: completedJuz, completedToday: juzCompletedToday(sessions, localDate) },
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
  // The Ramadan preset finishes at the end of Ramadan; the server knows it (Hijri calendar), the client doesn't have to.
  const preset = input.preset?.kind === "ramadan" && !input.preset.ramadanEnd ? { kind: "ramadan" as const, ramadanEnd: ramadanWindow(localDate).ramadanEnd } : (input.preset ?? DEFAULT_PRESET);
  const setup = planSetupFor(preset, localDate, startPage);
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

/** Any one of these resolves to a span of whole pages (lib/quran/ledger.ts). `ayah` is a GLOBAL ayah number (1..6236). */
export type LogReadingInput = { toPage: number } | { nextPage: number } | { todaysPortion: true } | { pages: number } | { ayah: number };
export type LogReadingResult = {
  /** null when only the exact ayah moved (no whole page was finished). */
  sessionId: string | null;
  pagesRead: number;
  fromPage: number;
  toPage: number;
  newCurrentPage: number;
  juzCompleted: number[];
  khatmComplete: boolean;
  date: string;
};

/** "today" / "yesterday", or an explicit local YYYY-MM-DD. */
export type LogForDate = "today" | "yesterday" | (string & {});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function resolveLogDate(localDate: string, forDate: LogForDate): string | null {
  if (forDate === "today") return localDate;
  if (forDate === "yesterday") return addDaysToDateString(localDate, -1);
  return DATE_RE.test(forDate) ? forDate : null;
}

/** The plan's reading log as ledger entries (only rows that carry a page span; legacy rows without one are never touched). */
async function loadLedger(supabase: SupabaseClient, userId: string, planId: string): Promise<LedgerEntry[]> {
  const { data, error } = await supabase.from("quran_sessions").select("id, date, from_page, to_page, created_at").eq("user_id", userId).eq("plan_id", planId).not("from_page", "is", null);
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.from_page !== null && r.to_page !== null)
    .map((r) => ({ id: r.id as string, date: r.date as string, from: r.from_page as number, to: r.to_page as number, seq: Date.parse(r.created_at as string) || 0 }));
}

const ledgerContext = (plan: StoredPlan, today: string): LedgerContext => ({ startPage: plan.startPage, startDate: plan.startDate, today });

/** Everything the card's History needs: the entries (any order), the pages no entry covers, and the derived bookmark. */
export async function getQuranLedgerCore(supabase: SupabaseClient, userId: string): Promise<{ entries: LedgerEntry[]; gaps: PageGap[]; bookmark: number } | null> {
  const plan = (await getOpenPlanCore(supabase, userId)) ?? (await getLatestPlanCore(supabase, userId));
  if (!plan) return null;
  const entries = await loadLedger(supabase, userId, plan.id);
  return { entries, gaps: ledgerGaps(entries, plan.startPage), bookmark: ledgerBookmark(entries, plan.startPage) };
}

type SessionWrite = { date: string; from: number; to: number };
const sessionRow = (userId: string, planId: string, w: SessionWrite) => ({
  user_id: userId,
  date: w.date,
  pages_read: w.to - w.from + 1,
  surah: surahLabelForSpan(w.from, w.to),
  juz: juzForPage(w.from),
  from_page: w.from,
  to_page: w.to,
  plan_id: planId,
});

/**
 * Applies ONE ledger change (an insert, an edit of one entry, or a delete) and brings the plan in line with it: the
 * bookmark is re-derived from the whole ledger (never trusted from the caller), the khatm completes / reopens when that
 * crosses page 604, and the exact ayah survives only while it still sits on the bookmark's page. The plan row moves first,
 * through a UPDATE guarded on the page it was read at (a concurrent change matches 0 rows), and is put back if the log write fails.
 */
async function applyLedgerChange(
  supabase: SupabaseClient,
  userId: string,
  plan: StoredPlan,
  localDate: string,
  nextLedger: readonly LedgerEntry[],
  change: { insert: SessionWrite } | { update: { id: string; write: SessionWrite } } | { remove: string } | { positionOnly: true },
  restAyah: number | null | undefined
): Promise<CoreResult<{ sessionId: string | null; newCurrentPage: number; khatmComplete: boolean }>> {
  const newCurrent = ledgerBookmark(nextLedger, plan.startPage);
  const finished = newCurrent > TOTAL_PAGES;
  const keepAyah = restAyah === undefined && plan.currentAyah !== null && newCurrent === plan.currentPage && pageOfAyah(plan.currentAyah) === newCurrent;
  const newAyah = finished ? null : restAyah !== undefined ? restAyah : keepAyah ? plan.currentAyah : null;
  const newStatus = finished ? "completed" : plan.status === "completed" ? "active" : plan.status;
  const planPatch: Record<string, unknown> = {};
  if (newCurrent !== plan.currentPage) planPatch.current_page = newCurrent;
  if (newAyah !== plan.currentAyah) planPatch.current_ayah = newAyah;
  if (newStatus !== plan.status) Object.assign(planPatch, newStatus === "completed" ? { status: "completed", completed_on: localDate } : { status: "active", completed_on: null });
  const planChanged = Object.keys(planPatch).length > 0;

  if (planChanged) {
    const { data: moved, error: moveError } = await supabase.from("quran_plans").update(planPatch).eq("id", plan.id).eq("user_id", userId).eq("current_page", plan.currentPage).select("id");
    if (moveError) {
      if ((moveError as { code?: string }).code === "23505") return { ok: false, message: "You've started another plan since, so that khatm can't be reopened." };
      throw moveError;
    }
    if (!moved || moved.length === 0) return { ok: false, message: "Your reading just changed on another device. Refresh and try again." };
  }
  const undoPlan = async () => {
    if (!planChanged) return;
    await supabase
      .from("quran_plans")
      .update({ current_page: plan.currentPage, current_ayah: plan.currentAyah, status: plan.status, completed_on: plan.completedOn })
      .eq("id", plan.id)
      .eq("user_id", userId)
      .eq("current_page", newCurrent);
  };

  let sessionId: string | null = null;
  if ("insert" in change) {
    const { data, error } = await supabase.from("quran_sessions").insert(sessionRow(userId, plan.id, change.insert)).select("id").single();
    if (error) {
      await undoPlan();
      throw error;
    }
    sessionId = data.id as string;
  } else if ("update" in change) {
    const { error } = await supabase.from("quran_sessions").update(sessionRow(userId, plan.id, change.update.write)).eq("id", change.update.id).eq("user_id", userId);
    if (error) {
      await undoPlan();
      throw error;
    }
    sessionId = change.update.id;
  } else if ("remove" in change) {
    const { error } = await supabase.from("quran_sessions").delete().eq("id", change.remove).eq("user_id", userId);
    if (error) {
      await undoPlan();
      throw error;
    }
  }
  return { ok: true, sessionId, newCurrentPage: newCurrent, khatmComplete: finished };
}

/**
 * Logs reading toward the open plan, in whichever way the reader thinks of it: `toPage` = the last page read, `nextPage` =
 * "I'm on page N" (= through N-1), `pages` = "I read N pages" (from where that day's reading left off), `ayah` = "I'm on
 * this ayah" (= through the page before it, and the exact place is remembered), `todaysPortion` = today's pages.
 * `forDate` files it under today, yesterday or any earlier day: it is placed right after the reading before that day and is
 * refused if it would run into the reading after it (the ledger must stay in page order with no overlap).
 */
export async function logQuranReadingCore(
  supabase: SupabaseClient,
  userId: string,
  localDate: string,
  input: LogReadingInput,
  forDate: LogForDate = "today"
): Promise<CoreResult<LogReadingResult>> {
  const plan = await getOpenPlanCore(supabase, userId);
  if (!plan) return { ok: false, message: "Start a Quran plan first." };
  if (plan.status === "paused") return { ok: false, message: "Your plan is paused. Resume it to log reading." };

  const date = resolveLogDate(localDate, forDate);
  if (!date) return { ok: false, message: "Pick a valid day." };
  if (date < plan.startDate) return { ok: false, message: "That day is before your plan started." };

  const ledger = await loadLedger(supabase, userId, plan.id);
  let method: LogMethod;
  if ("todaysPortion" in input) {
    const portion = todaysPortion(plan, localDate);
    if (!portion) return { ok: false, message: "There is no portion to log today." };
    method = { kind: "throughPage", page: portion.to };
  } else if ("nextPage" in input) {
    method = { kind: "onPage", page: input.nextPage };
  } else if ("pages" in input) {
    method = { kind: "pages", count: input.pages };
  } else if ("ayah" in input) {
    if (!Number.isInteger(input.ayah) || input.ayah < 1 || input.ayah > 6236) return { ok: false, message: "That ayah doesn't exist." };
    method = { kind: "onAyah", ayah: input.ayah };
  } else {
    method = { kind: "throughPage", page: input.toPage };
  }

  const ctx = ledgerContext(plan, localDate);
  const resolved = resolveLog(ledger, date, method, ctx);
  if (!resolved.ok) return resolved;

  if (resolved.positionOnly) {
    const res = await applyLedgerChange(supabase, userId, plan, localDate, ledger, { positionOnly: true }, resolved.restAyah);
    if (!res.ok) return res;
    return { ok: true, sessionId: null, pagesRead: 0, fromPage: resolved.entry.from, toPage: resolved.entry.from - 1, newCurrentPage: res.newCurrentPage, juzCompleted: [], khatmComplete: false, date };
  }

  const { from, to } = resolved.entry;
  const next: LedgerEntry[] = [...ledger, { id: NEW_ENTRY_ID, date, from, to, seq: Number.MAX_SAFE_INTEGER }];
  const res = await applyLedgerChange(supabase, userId, plan, localDate, next, { insert: { date, from, to } }, resolved.restAyah);
  if (!res.ok) return res;
  return { ok: true, sessionId: res.sessionId, pagesRead: to - from + 1, fromPage: from, toPage: to, newCurrentPage: res.newCurrentPage, juzCompleted: juzCompletedBetween(from, to + 1), khatmComplete: res.khatmComplete, date };
}

/** The open plan, else the latest finished khatm (History can fix a completed khatm and reopen it). */
async function planForEdit(supabase: SupabaseClient, userId: string): Promise<StoredPlan | null> {
  return (await getOpenPlanCore(supabase, userId)) ?? (await getLatestPlanCore(supabase, userId));
}

/** Changes one logged day (its date and/or its first/last page). Refused when it would overlap or run out of order with the days around it. */
export async function editQuranLogEntryCore(supabase: SupabaseClient, userId: string, localDate: string, entryId: string, patch: EntryPatch): Promise<CoreResult<{ currentPage: number }>> {
  const plan = await planForEdit(supabase, userId);
  if (!plan) return { ok: false, message: "Start a Quran plan first." };
  if (patch.date !== undefined && !DATE_RE.test(patch.date)) return { ok: false, message: "Pick a valid day." };
  const ledger = await loadLedger(supabase, userId, plan.id);
  const edited = editEntry(ledger, entryId, patch, ledgerContext(plan, localDate));
  if (!edited.ok) return edited;
  const row = edited.entries.find((e) => e.id === entryId)!;
  const res = await applyLedgerChange(supabase, userId, plan, localDate, edited.entries, { update: { id: entryId, write: { date: row.date, from: row.from, to: row.to } } }, undefined);
  if (!res.ok) return res;
  return { ok: true, currentPage: res.newCurrentPage };
}

/** Removes one logged day. The pages it covered become a gap (shown in History) and the bookmark follows the furthest page still logged. */
export async function deleteQuranLogEntryCore(supabase: SupabaseClient, userId: string, localDate: string, entryId: string): Promise<CoreResult<{ currentPage: number }>> {
  const plan = await planForEdit(supabase, userId);
  if (!plan) return { ok: false, message: "Start a Quran plan first." };
  const ledger = await loadLedger(supabase, userId, plan.id);
  if (!ledger.some((e) => e.id === entryId)) return { ok: false, message: "That entry no longer exists. Refresh and try again." };
  const res = await applyLedgerChange(supabase, userId, plan, localDate, removeEntry(ledger, entryId), { remove: entryId }, undefined);
  if (!res.ok) return res;
  return { ok: true, currentPage: res.newCurrentPage };
}

/** Undoes the most recently SAVED log of the latest plan (whatever day it was filed under). */
export async function undoLastQuranLogCore(supabase: SupabaseClient, userId: string, localDate: string = ""): Promise<CoreResult<{ currentPage: number }>> {
  const plan = await planForEdit(supabase, userId);
  if (!plan) return { ok: false, message: "Nothing to undo." };
  const ledger = await loadLedger(supabase, userId, plan.id);
  const last = lastSavedEntry(ledger);
  if (!last) return { ok: false, message: "Nothing to undo." };
  const res = await applyLedgerChange(supabase, userId, plan, localDate, removeEntry(ledger, last.id), { remove: last.id }, undefined);
  if (!res.ok) return res;
  return { ok: true, currentPage: res.newCurrentPage };
}

/**
 * Sets the NEXT page to read, 1..604 (absolute). Moving forward logs the skipped pages as today's reading; moving back
 * trims the log (entries at or after that page go, the one straddling it is cut short), so the log always matches the bookmark.
 */
export async function setQuranBookmarkCore(supabase: SupabaseClient, userId: string, page: number, localDate: string = ""): Promise<CoreResult<{ currentPage: number }>> {
  if (!Number.isInteger(page) || page < 1 || page > TOTAL_PAGES) return { ok: false, message: `Page must be between 1 and ${TOTAL_PAGES}.` };
  const plan = await getOpenPlanCore(supabase, userId);
  if (!plan) return { ok: false, message: "Start a Quran plan first." };
  if (page < plan.startPage) return { ok: false, message: `Your plan starts at page ${plan.startPage}.` };
  const ledger = await loadLedger(supabase, userId, plan.id);
  const current = ledgerBookmark(ledger, plan.startPage);
  if (page === current) return { ok: true, currentPage: current };
  if (page > current) {
    const logged = await logQuranReadingCore(supabase, userId, localDate, { nextPage: page });
    return logged.ok ? { ok: true, currentPage: logged.newCurrentPage } : logged;
  }
  const trimmed = trimLedgerTo(ledger, page);
  const keptIds = new Set(trimmed.map((e) => e.id));
  for (const e of ledger) {
    if (keptIds.has(e.id)) {
      const cut = trimmed.find((t) => t.id === e.id)!;
      if (cut.to !== e.to) {
        const { error } = await supabase.from("quran_sessions").update(sessionRow(userId, plan.id, { date: cut.date, from: cut.from, to: cut.to })).eq("id", e.id).eq("user_id", userId);
        if (error) throw error;
      }
    } else {
      const { error } = await supabase.from("quran_sessions").delete().eq("id", e.id).eq("user_id", userId);
      if (error) throw error;
    }
  }
  const { data, error } = await supabase.from("quran_plans").update({ current_page: page, current_ayah: null }).eq("id", plan.id).eq("user_id", userId).select("id");
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

