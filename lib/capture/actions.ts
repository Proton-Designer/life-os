"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { addTaskCore } from "@/lib/tasks/actions-core";
import { createTriggerAndLog } from "@/app/(app)/distractions/actions";
import type { DistractionDomain } from "@/lib/distractions/types";

// Global capture (BOSS-VISION §5) persists through EXISTING actions/tables only — no new
// table, no new domain value invented here. Each function below is a thin router to one of
// three destinations already in this codebase; none of them duplicate what those
// destinations already enforce (RLS, idempotent trigger matching, revalidation).

async function todayForCapture(): Promise<string> {
  const profile = await getProfile();
  return localDateString(new Date(), profile?.timezone ?? "UTC");
}

/**
 * Task capture -> the existing school task action (app/(app)/school/actions.ts's
 * `addTaskCore` call, domain hardcoded to "school" there and here — that action has no
 * other domain path, and `tasks.domain` is CHECK-constrained to `school`/`co_op` with no
 * third option). Deliberately omits `taskType` and never touches `estimated_minutes` —
 * `addTaskCore` has no such parameter at all, so a captured task earns both later rather
 * than the capture sheet guessing either. `dueDate` is whatever the parser resolved (or
 * omitted if nothing did) — never defaulted to today, which would fabricate a deadline
 * nobody stated.
 */
export async function captureTask(input: { title: string; dueDate?: string | null }): Promise<void> {
  await addTaskCore({
    domain: "school",
    title: input.title,
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
  });
  revalidatePath("/");
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
 * `domain: null` + `dump_source: "capture"` (migrations 119/120, both on production
 * 2026-09-02): `domain: "school"` was the lie R54 forbids — a captured worry stored as
 * school work — and Worry/Note were hidden from the picker (R57) until this landed.
 *
 * `dump_source` IS "capture", not "worry"/"note" — per the LifeOS lead's vocabulary
 * mapping between the Night Plan engine's `DumpSource` and this column: `worry` and
 * `note` (`user`) are the Night Plan ritual's own values (app/(app)/close/plan-actions.ts),
 * `capture` is this surface's, and that is the ONLY fact that will later tell "typed
 * during the evening close" apart from "typed anytime via global capture" — the Worry vs
 * Note choice in THIS sheet is a content hint for the person typing, not a second
 * persisted origin, so it is never passed here.
 *
 * The write is VERIFIED, not just requested: reads the row back via `.select().single()`
 * and throws if it doesn't actually carry `domain: null` / `dump_source: "capture"` —
 * catches a future regression (a reintroduced default, an unexpected trigger) the moment
 * it ships rather than letting a captured worry silently look like something else again.
 *
 * `today` is always resolved via `localDateString`, never `new Date()`/`current_date`
 * directly (AGENTS.md's timezone rule, and the LifeOS lead's own production proof that a
 * server-derived date lands on the wrong calendar day whenever UTC and the user's local
 * day disagree) — `planned_date` is the day the worry/note was dumped, not a parsed date,
 * so "today" is always correct for it.
 */
export async function captureDump(input: { title: string }): Promise<void> {
  const { supabase, userId } = await requireUser();
  const plannedDate = await todayForCapture();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      domain: null,
      dump_source: "capture",
      title: input.title,
      planned_date: plannedDate,
    })
    .select("domain, dump_source")
    .single();
  if (error) throw error;
  if (data.domain !== null || data.dump_source !== "capture") {
    throw new Error(`captureDump wrote the wrong shape: domain=${data.domain}, dump_source=${data.dump_source}`);
  }
  revalidatePath("/");
}
