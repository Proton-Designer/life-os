"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { isOptInFeatureOnForRequest, FEATURE_OFF_MESSAGE } from "@/lib/opt-in-guard";
import { getWindDownSettingsCore, saveWindDownPlanCore, type WindDownSettings } from "@/lib/rhythm/wind-down-core";

/** The set-once wind-down plan (IA-P4a). Gated by the `sleep_plan` opt-in: OFF reads as "not set" and refuses writes (data untouched). */
export async function getWindDownSettings(): Promise<WindDownSettings | null> {
  const { supabase, userId } = await requireUser();
  if (!(await isOptInFeatureOnForRequest("sleep_plan"))) return null;
  return getWindDownSettingsCore(supabase, userId);
}

export async function saveWindDownPlan(input: { wakeTime: string; sleepNeedMinutes: number; windDownMinutes?: number }): Promise<{ ok: true; bedtime: string; windDownStart: string } | { ok: false; message: string }> {
  const { supabase, userId } = await requireUser();
  if (!(await isOptInFeatureOnForRequest("sleep_plan"))) return { ok: false, message: FEATURE_OFF_MESSAGE };
  try {
    const plan = await saveWindDownPlanCore(supabase, userId, input);
    revalidatePath("/");
    revalidatePath("/settings");
    return { ok: true, bedtime: plan.bedtime, windDownStart: plan.windDownStart };
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string } | null)?.message;
    return { ok: false, message: message ?? "Couldn't save your wind-down plan." };
  }
}
