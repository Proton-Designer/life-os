"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { isOptInFeatureOnForRequest, FEATURE_OFF_MESSAGE } from "@/lib/opt-in-guard";
import {
  createMorningRoutineItemCore,
  archiveMorningRoutineItemCore,
  checkMorningRoutineItemCore,
  uncheckMorningRoutineItemCore,
  getMorningRoutineChecklistCore,
  type MorningRoutineChecklistItem,
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

/** THIN WRAPPER over createMorningRoutineItemCore (P3-01) -- the MCP write tool calls the same core. */
export async function createMorningRoutineItem(label: string): Promise<MorningRoutineActionResult> {
  const { supabase, userId } = await requireUser();
  if (!(await isOptInFeatureOnForRequest("morning_routine"))) return { ok: false, message: FEATURE_OFF_MESSAGE };
  try {
    await createMorningRoutineItemCore(supabase, userId, label);
    revalidatePath("/");
    return { ok: true };
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
