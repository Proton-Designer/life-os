"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getProfile } from "@/lib/supabase/auth";
import { isOptInFeatureOnForRequest, FEATURE_OFF_MESSAGE } from "@/lib/opt-in-guard";
import { getSleepIntentCore, saveSleepIntentCore, clearSleepIntentCore, todayLocalDateStringCore } from "@/lib/night-plan/sleep-intent-core";

async function todayLocalDateString(): Promise<string> {
  const profile = await getProfile();
  return todayLocalDateStringCore(new Date(), profile?.timezone ?? "UTC");
}

/** Reads today's sleep intent, or null if none has been set (or it was cleared) -- both a genuinely-not-set night and a read error degrade to null, since this is a display-only, best-effort read (same posture as lib/ai/morning-brief.ts's getMorningBriefForToday). THIN WRAPPER over getSleepIntentCore (P4-07). */
export async function getMySleepIntentForToday(): Promise<string | null> {
  const { supabase, userId } = await requireUser();
  // Opt-in feature OFF (RS-01): nothing to read; the data stays untouched.
  if (!(await isOptInFeatureOnForRequest("sleep_plan"))) return null;
  const todayStr = await todayLocalDateString();
  return getSleepIntentCore(supabase, userId, todayStr);
}

/** THIN WRAPPER over saveSleepIntentCore (lib/night-plan/sleep-intent-core.ts, P4-07) -- the MCP write tool calls the same core. */
export async function saveMySleepIntent(time: string): Promise<{ ok: boolean; message: string }> {
  const { supabase, userId } = await requireUser();
  if (!(await isOptInFeatureOnForRequest("sleep_plan"))) return { ok: false, message: FEATURE_OFF_MESSAGE };
  const todayStr = await todayLocalDateString();
  const result = await saveSleepIntentCore(supabase, userId, todayStr, time);
  if (result.ok) revalidatePath("/");
  return result;
}

/** THIN WRAPPER over clearSleepIntentCore (lib/night-plan/sleep-intent-core.ts, P4-07) -- the MCP write tool calls the same core. */
export async function clearMySleepIntent(): Promise<{ ok: boolean; message: string }> {
  const { supabase, userId } = await requireUser();
  if (!(await isOptInFeatureOnForRequest("sleep_plan"))) return { ok: false, message: FEATURE_OFF_MESSAGE };
  const todayStr = await todayLocalDateString();
  const result = await clearSleepIntentCore(supabase, userId, todayStr);
  if (result.ok) revalidatePath("/");
  return result;
}
