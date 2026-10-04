"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { updateLaunchStepCore, type LaunchStepPatch } from "@/lib/morning-routine/step-edit-core";
import { isOptInFeatureOnForRequest, FEATURE_OFF_MESSAGE } from "@/lib/opt-in-guard";
import {
  createMorningRoutineItemCore,
  archiveMorningRoutineItemCore,
  checkMorningRoutineItemCore,
  uncheckMorningRoutineItemCore,
  getMorningRoutineChecklistCore,
  setLaunchStepDoneCore,
  type LaunchStepOptions,
  type MorningRoutineChecklistItem,
  type MorningRoutineItem,
} from "@/lib/morning-routine/actions-core";

async function timezoneForCurrentUser(): Promise<string> {
  const profile = await getProfile();
  return profile?.timezone ?? "UTC";
}

/** Reads today's checklist, tz-correct. THIN WRAPPER over getMorningRoutineChecklistCore (P3-01) -- the MCP read path calls the same core once it exists (see this task's own OPEN_QUESTIONS.md note on the known read-registry gap). */
export async function getMyMorningRoutineChecklist(): Promise<MorningRoutineChecklistItem[]> {
  const { supabase, userId } = await requireUser();
  // Opt-in feature OFF (RS-01): nothing to read; the data stays untouched.
  if (!(await isOptInFeatureOnForRequest("morning_routine"))) return [];
  const timezone = await timezoneForCurrentUser();
  return getMorningRoutineChecklistCore(supabase, userId, new Date(), timezone);
}

export type MorningRoutineActionResult = { ok: true } | { ok: false; message: string };
export type CreateStepResult = { ok: true; item: MorningRoutineItem } | { ok: false; message: string };

/** THIN WRAPPER over createMorningRoutineItemCore (P3-01) -- the MCP write tool calls the same core. */
export async function createMorningRoutineItem(label: string, options: LaunchStepOptions = {}): Promise<CreateStepResult> {
  const { supabase, userId } = await requireUser();
  if (!(await isOptInFeatureOnForRequest("morning_routine"))) return { ok: false, message: FEATURE_OFF_MESSAGE };
  try {
    // Returns the new row (IA-P4a) so the card can show it at once instead of waiting for a re-render.
    const item = await createMorningRoutineItemCore(supabase, userId, label, options);
    revalidatePath("/");
    return { ok: true, item };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't add that item." };
  }
}

/** THIN WRAPPER over archiveMorningRoutineItemCore (P3-01) -- the MCP write tool calls the same core. Never a hard delete. */
export async function archiveMorningRoutineItem(itemId: string): Promise<MorningRoutineActionResult> {
  const { supabase, userId } = await requireUser();
  if (!(await isOptInFeatureOnForRequest("morning_routine"))) return { ok: false, message: FEATURE_OFF_MESSAGE };
  try {
    await archiveMorningRoutineItemCore(supabase, userId, itemId);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't remove that item." };
  }
}

/** THIN WRAPPER over checkMorningRoutineItemCore (P3-01) -- the MCP write tool calls the same core. Always today; there is no UI path to backfill a past day. */
export async function checkMorningRoutineItem(itemId: string): Promise<MorningRoutineActionResult> {
  const { supabase, userId } = await requireUser();
  if (!(await isOptInFeatureOnForRequest("morning_routine"))) return { ok: false, message: FEATURE_OFF_MESSAGE };
  const timezone = await timezoneForCurrentUser();
  const now = new Date();
  try {
    await checkMorningRoutineItemCore(supabase, userId, itemId, localDateString(now, timezone), now, timezone);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't check that item off." };
  }
}

/** THIN WRAPPER over uncheckMorningRoutineItemCore (P3-01) -- the MCP write tool calls the same core. */
export async function uncheckMorningRoutineItem(itemId: string): Promise<MorningRoutineActionResult> {
  const { supabase, userId } = await requireUser();
  if (!(await isOptInFeatureOnForRequest("morning_routine"))) return { ok: false, message: FEATURE_OFF_MESSAGE };
  const timezone = await timezoneForCurrentUser();
  const now = new Date();
  try {
    await uncheckMorningRoutineItemCore(supabase, userId, itemId, localDateString(now, timezone), now, timezone);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't undo that check." };
  }
}

/**
 * IA-P4a: the Launch sequence's ONE tap action — an absolute setter (`done`), never a toggle. A
 * step linked to an identity habit also casts / retracts that habit's vote (same local day).
 * Lean: no inline revalidatePath; the card schedules ONE refreshLaunchViews() per burst (PERF
 * pattern). The date is server-derived, never taken from the client.
 */
export async function setLaunchStepDone(itemId: string, done: boolean): Promise<MorningRoutineActionResult> {
  const { supabase, userId } = await requireUser();
  if (!(await isOptInFeatureOnForRequest("morning_routine"))) return { ok: false, message: FEATURE_OFF_MESSAGE };
  const timezone = await timezoneForCurrentUser();
  const now = new Date();
  try {
    await setLaunchStepDoneCore(supabase, userId, itemId, done, localDateString(now, timezone), now, timezone);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string } | null)?.message;
    return { ok: false, message: message ?? "Couldn't save that tick." };
  }
}

/** Data-free cache revalidation scheduled by the Launch sequence card after a burst of ticks (also re-syncs Habits' vote counts). Touches no data. */
export async function refreshLaunchViews(): Promise<void> {
  await requireUser();
  revalidatePath("/");
  revalidatePath("/week");
}

/**
 * IA-P4b: edit a Launch-sequence step in place (label, "when" cue, 2-minute version, linked habit).
 * Gated by the morning_routine opt-in like every routine action; the core re-checks ownership.
 */
export async function updateLaunchStep(itemId: string, patch: LaunchStepPatch): Promise<MorningRoutineActionResult> {
  const { supabase, userId } = await requireUser();
  if (!(await isOptInFeatureOnForRequest("morning_routine"))) return { ok: false, message: FEATURE_OFF_MESSAGE };
  try {
    await updateLaunchStepCore(supabase, userId, itemId, patch);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't save that step." };
  }
}
