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
export async function captureDump(input: { title: string; source: "worry" | "capture" }): Promise<void> {
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
    })
    .select("domain, dump_source")
    .single();
  if (error) throw error;
  if (data.domain !== null || data.dump_source !== input.source) {
    throw new Error(`captureDump wrote the wrong shape: domain=${data.domain}, dump_source=${data.dump_source}`);
  }
  revalidatePath("/");
}
