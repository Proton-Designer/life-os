"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { createTriggerAndLog } from "@/app/(app)/distractions/actions";
import type { DistractionDomain } from "@/lib/distractions/types";
import { isCaptureArea, type CaptureArea } from "@/lib/capture/areas";
import { captureAreaTaskCore } from "@/lib/capture/capture-task-core";
import { getTaskDay } from "@/lib/day-structure/task-day";
import { loadHasKillList } from "@/lib/inbox/close-inbox";

// Global capture (BOSS-VISION §5) persists through EXISTING actions/tables only — no new
// table, no new domain value invented here. Each function below is a thin router to one of
// three destinations already in this codebase; none of them duplicate what those
// destinations already enforce (RLS, idempotent trigger matching, revalidation).

async function todayForCapture(): Promise<string> {
  const profile = await getProfile();
  return localDateString(new Date(), profile?.timezone ?? "UTC");
}

/**
 * Task capture (IA-P1a): the caller picks the AREA — "school" / "co_op" / "business" become a line on today's plan
 * that also lands where the area keeps its tasks (capture-task-core.ts: School list, Work Backlog, Kill List), unless the
 * task carries another date (then School/Work stay plain dated tasks and Business goes to the Inbox with its date);
 * "none" is the Inbox: a `domain: null`,
 * `dump_source: 'capture'` row via `captureDump`, triaged in the evening close. `area` is
 * validated here (a Server Action input is untrusted) and never defaulted: a missing or
 * unknown area throws rather than quietly filing the task under School again. Deliberately
 * omits `taskType` and never touches `estimated_minutes` — `addTaskCore` has no such
 * parameter at all, so a captured task earns both later rather than the capture sheet
 * guessing either. `dueDate` is whatever the parser resolved (or omitted if nothing did) —
 * never defaulted to today, which would fabricate a deadline nobody stated.
 */
export async function captureTask(input: {
  title: string;
  area: CaptureArea;
  dueDate?: string | null;
  /** "HH:MM" local time, as parsed by parse-utterance.ts. Threaded straight to
   * `addTaskCore`'s `dueTime` (writes `tasks.due_time`) — every downstream reader that
   * keys off a task having a time (get-day-shape's timeline, calendar's timed-block
   * bucket, get-priority-items' urgency ranking) only sees a task at all once this is
   * passed, so silently dropping it here is the bug, not a simplification. */
  dueTime?: string | null;
  /** Start time ("HH:MM"), timer (minutes) and criteria set on the sheet, as in Edit Plan. Any of them makes the task a line on today's plan. */
  details?: { startTime?: string | null; durationMinutes?: number | null; criteria?: string | null };
}): Promise<void> {
  if (!isCaptureArea(input.area)) throw new Error("Pick an area for this task");
  const hasDetails = !!(input.details?.startTime || input.details?.durationMinutes || input.details?.criteria?.trim());
  // A "No area" Task stays in the Inbox unless it was given a time, timer or criteria for the plan day: those only
  // exist on a plan line, so it becomes a plan line with no domain, exactly as in Edit Plan.
  const { supabase, userId } = await requireUser();
  const profile = await getProfile();
  const planDay = await getTaskDay(supabase, userId, new Date(), profile?.timezone ?? "UTC");
  if (input.area === "none" && !(hasDetails && (!input.dueDate || input.dueDate === planDay))) {
    await captureDump({ title: input.title, source: "capture", dueDate: input.dueDate ?? null, dueTime: input.dueTime ?? null });
    return;
  }
  const planArea = input.area === "none" ? null : input.area;
  const killListAvailable = input.area === "business" ? await loadHasKillList() : false;
  if (input.area === "business" && !killListAvailable) throw new Error("This account has no Business Kill List");
  const res = await captureAreaTaskCore(supabase, userId, planDay, { title: input.title, area: planArea, dueDate: input.dueDate, dueTime: input.dueTime, details: input.details }, { killListAvailable });
  if (res.kind === "inbox-dated") {
    await captureDump({ title: input.title, source: "capture", dueDate: input.dueDate ?? null, dueTime: input.dueTime ?? null });
    return;
  }
  revalidatePath("/");
  if (res.kind === "planned") {
    if (input.area === "business") revalidatePath("/business");
    if (input.area === "school") revalidatePath("/school", "layout");
    if (input.area === "co_op") revalidatePath("/work", "layout");
  }
}

/**
 * Distraction capture -> the existing distractions review action
 * (createTriggerAndLog), never `distraction_triggers` directly — reuses its idempotent
 * name-matching (a second capture of the same trigger name logs against the existing
 * trigger rather than creating a duplicate) and its RLS/date handling as-is.
 */
export async function captureDistraction(input: { title: string; domain: DistractionDomain }): Promise<void> {
  await createTriggerAndLog({ domain: input.domain, name: input.title, description: null });
  revalidatePath("/");
}

/**
 * Worry/note capture -> the Night Plan dump (BOSS-VISION §5 ruling, 2026-09-02: "no new
 * table"). `tasks.planned_date` (migration 113) is the only column that exists for this;
 * `mit_rank` is left null (a real "written down, not chosen" state, per that migration's
 * own comment — never defaulted, never backfilled).
 *
 * `domain: null` always (migrations 119/120, both on production 2026-09-02): `domain:
 * "school"` was the lie R54 forbids — a captured worry stored as school work — and
 * Worry/Note were hidden from the picker (R57) until this landed.
 *
 * `dump_source` is NOT uniform, though — corrected after the first pass wrote "capture"
 * for everything. The Boss's distinction: `dump_source` mixes KINDS of seed (school,
 * milestone, worry) with SURFACES (capture). A parked worry is a KIND the Night Plan's
 * seeding and the Monday anti-worry hour must find regardless of which surface parked
 * it, so it can never be flattened to "capture" just because it came through this sheet.
 * Only an undifferentiated note — no kind, nothing to seed by — gets "capture". So the
 * caller passes `source` explicitly: the Worry button sends `"worry"`, the Note button
 * sends `"capture"`. (`"note"`, the fourth CHECK value, is the evening-close ritual's own
 * — app/(app)/close/plan-actions.ts, same concept as the engine's `DumpSource: "user"` —
 * never written from this sheet.)
 *
 * The write is VERIFIED, not just requested: reads the row back via `.select().single()`
 * and throws if it doesn't actually carry `domain: null` and the REQUESTED `dump_source`
 * — catches a future regression (a reintroduced default, an unexpected trigger, a source
 * silently swapped) the moment it ships rather than letting a captured worry silently
 * look like something else again.
 *
 * `today` is always resolved via `localDateString`, never `new Date()`/`current_date`
 * directly (AGENTS.md's timezone rule, and the LifeOS lead's own production proof that a
 * server-derived date lands on the wrong calendar day whenever UTC and the user's local
 * day disagree) — `planned_date` is the day the worry/note was dumped, not a parsed date,
 * so "today" is always correct for it.
 */
export async function captureDump(input: {
  title: string;
  source: "worry" | "capture";
  /** Only a "capture" Inbox task carries these (IA-P1a: a "No area" Task keeps the date/time the parser resolved). */
  dueDate?: string | null;
  dueTime?: string | null;
}): Promise<void> {
  const { supabase, userId } = await requireUser();
  const plannedDate = await todayForCapture();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      domain: null,
      dump_source: input.source,
      title: input.title,
      planned_date: plannedDate,
      ...(input.dueDate ? { due_date: input.dueDate } : {}),
      ...(input.dueTime ? { due_time: input.dueTime } : {}),
    })
    .select("domain, dump_source")
    .single();
  if (error) throw error;
  if (data.domain !== null || data.dump_source !== input.source) {
    throw new Error(`captureDump wrote the wrong shape: domain=${data.domain}, dump_source=${data.dump_source}`);
  }
  revalidatePath("/");
}
