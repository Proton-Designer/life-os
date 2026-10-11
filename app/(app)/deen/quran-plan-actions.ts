"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { isDeenModeOnForRequest, getRequestTimezone, DEEN_MODE_OFF_MESSAGE } from "@/lib/deen/deen-mode-guard";
import { QURAN_VIEW_PATHS } from "@/lib/quran/plan";
import type { EntryPatch } from "@/lib/quran/ledger";
import {
  deleteQuranLogEntryCore,
  editQuranLogEntryCore,
  getQuranOverviewCore,
  keepOrMoveFinishDateCore,
  logQuranReadingCore,
  pauseQuranPlanCore,
  resumeQuranPlanCore,
  setQuranBookmarkCore,
  startNextKhatmCore,
  startQuranPlanCore,
  undoLastQuranLogCore,
  type CoreResult,
  type LogForDate,
  type LogReadingInput,
  type LogReadingResult,
  type QuranOverview,
  type StartPlanInput,
} from "@/lib/quran/plan-core";

/**
 * QURAN-01: the khatm plan's Server Actions. EVERY one is Deen-gated server-side (OFF = refused, data untouched), resolves
 * the user's LOCAL date from their profile timezone (never a UTC date), and revalidates every page that shows the plan
 * (QURAN_VIEW_PATHS: /deen, /, /close, /week, /insights). Thin wrappers over lib/quran/plan-core.ts, which the MCP twins call too.
 * Results are { ok:true, ... } | { ok:false, message }; expected refusals never throw.
 */

const OFF = { ok: false as const, message: DEEN_MODE_OFF_MESSAGE };

async function gate() {
  const { supabase, userId } = await requireUser();
  if (!(await isDeenModeOnForRequest())) return null;
  const timezone = await getRequestTimezone();
  return { supabase, userId, localDate: localDateString(new Date(), timezone) };
}

function revalidateQuranViews(): void {
  for (const path of QURAN_VIEW_PATHS) revalidatePath(path);
}

async function run<T>(fn: (c: NonNullable<Awaited<ReturnType<typeof gate>>>) => Promise<CoreResult<T>>, fallback: string): Promise<CoreResult<T>> {
  const ctx = await gate();
  if (!ctx) return OFF;
  try {
    const res = await fn(ctx);
    if (res.ok) revalidateQuranViews();
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : ((err as { message?: string } | null)?.message ?? fallback);
    return { ok: false, message: message || fallback };
  }
}

/** The card's data (null while Deen Mode is off). Home/close/week readers call getQuranOverviewCore directly with their own Deen gate. */
export async function getMyQuranOverview(): Promise<QuranOverview | null> {
  const ctx = await gate();
  if (!ctx) return null;
  return getQuranOverviewCore(ctx.supabase, ctx.userId, ctx.localDate);
}

/** Creates the plan. Default preset "Finish in 60 days" from page 1. Presets: 30/60 days, 6 months, Ramadan, custom date, custom pace. */
export async function startQuranPlan(input: StartPlanInput = {}): Promise<CoreResult<{ planId: string; khatmNumber: number }>> {
  return run((c) => startQuranPlanCore(c.supabase, c.userId, c.localDate, input), "Couldn't start the plan.");
}

/**
 * `{ toPage }` last page read, `{ nextPage }` "I'm on page N", `{ pages }` "I read N pages", `{ ayah }` "I'm on this ayah"
 * (global number), or `{ todaysPortion: true }`. `forDate` is "today", "yesterday" or any earlier local day (YYYY-MM-DD):
 * it is placed after the reading before that day and refused if it would overlap the reading after it.
 */
export async function logQuranReading(input: LogReadingInput, options: { forDate?: LogForDate } = {}): Promise<CoreResult<LogReadingResult>> {
  return run((c) => logQuranReadingCore(c.supabase, c.userId, c.localDate, input, options.forDate ?? "today"), "Couldn't save that reading.");
}

export async function undoLastQuranLog(): Promise<CoreResult<{ currentPage: number }>> {
  return run((c) => undoLastQuranLogCore(c.supabase, c.userId, c.localDate), "Couldn't undo that.");
}

/** History: change one logged day's date / first page / last page. Refused (with the reason) when it would overlap or run out of order with its neighbours. */
export async function editQuranLogEntry(entryId: string, patch: EntryPatch): Promise<CoreResult<{ currentPage: number }>> {
  return run((c) => editQuranLogEntryCore(c.supabase, c.userId, c.localDate, entryId, patch), "Couldn't change that day.");
}

/** History: remove one logged day (its pages become a gap that can be filled again). */
export async function deleteQuranLogEntry(entryId: string): Promise<CoreResult<{ currentPage: number }>> {
  return run((c) => deleteQuranLogEntryCore(c.supabase, c.userId, c.localDate, entryId), "Couldn't remove that day.");
}

/** Absolute: the NEXT page to read (1-604). The only way to move the bookmark backwards. */
export async function setQuranBookmark(page: number): Promise<CoreResult<{ currentPage: number }>> {
  return run((c) => setQuranBookmarkCore(c.supabase, c.userId, page, c.localDate), "Couldn't update the bookmark.");
}

/** newDate null = "Keep the date" (re-spread the remaining pages to the same finish day); a date = "Move the date". */
export async function keepOrMoveFinishDate(newDate: string | null): Promise<CoreResult<{ targetDate: string }>> {
  return run((c) => keepOrMoveFinishDateCore(c.supabase, c.userId, c.localDate, newDate), "Couldn't update the finish date.");
}

export async function pauseQuranPlan(): Promise<CoreResult> {
  return run((c) => pauseQuranPlanCore(c.supabase, c.userId, c.localDate), "Couldn't pause the plan.");
}

export async function resumeQuranPlan(): Promise<CoreResult> {
  return run((c) => resumeQuranPlanCore(c.supabase, c.userId, c.localDate), "Couldn't resume the plan.");
}

/** After a completed khatm: Khatm N+1 at the same pace, from page 1 today. */
export async function startNextKhatm(): Promise<CoreResult<{ planId: string; khatmNumber: number }>> {
  return run((c) => startNextKhatmCore(c.supabase, c.userId, c.localDate), "Couldn't start the next khatm.");
}
