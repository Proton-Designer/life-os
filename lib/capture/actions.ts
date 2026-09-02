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
 * table"). `tasks.planned_date` (migration 113) is the only column that exists for this
 * today; a plain insert with `planned_date` set and `mit_rank` left null (a real "written
 * down, not chosen" state, per that migration's own comment — never defaulted, never
 * backfilled). `domain` uses "school" to match `addTaskCore`'s own established default,
 * since `tasks.domain`'s CHECK constraint (school|co_op) has no domain-agnostic value to
 * reach for instead.
 *
 * RULED, R57 (2026-09-02): writing a captured worry/note as `domain: "school"` is the lie
 * R54 forbids, so this function is currently UNREACHABLE from the capture sheet — Worry
 * and Note are hidden from the type picker (components/capture/global-capture-sheet.tsx's
 * own comment) until migration 120 lands. Two migrations are in progress (LifeOS lead):
 * 119 makes `tasks.domain` nullable; 120 (its own file) adds `tasks.dump_source`
 * (school|milestone|worry|note|capture) — the column this function was missing when the
 * domain question was first flagged (2026-09-02, R51 resume). Once 120 is on production:
 * write `domain: null` and `dump_source` (accept it as a new required param here) instead
 * of the placeholder below, and re-add Worry/Note to the picker. Nothing else about this
 * function's caller contract changes.
 *
 * `today` is always resolved via `localDateString`, never `new Date()`/`current_date`
 * directly (AGENTS.md's timezone rule) — `planned_date` is the day the worry/note was
 * dumped, not a parsed date, so "today" is always correct for it.
 */
export async function captureDump(input: { title: string }): Promise<void> {
  const { supabase, userId } = await requireUser();
  const plannedDate = await todayForCapture();
  const { error } = await supabase.from("tasks").insert({
    user_id: userId,
    domain: "school",
    title: input.title,
    planned_date: plannedDate,
  });
  if (error) throw error;
  revalidatePath("/");
}
