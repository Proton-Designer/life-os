import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { MAX_ROUTINE_ITEMS, createMorningRoutineItemCore } from "@/lib/morning-routine/actions-core";
import { saveWindDownPlanCore } from "@/lib/rhythm/wind-down-core";
import { DEFAULT_WIND_DOWN_MINUTES, validateWindDownInputs, type WindDownPlan } from "@/lib/rhythm/wind-down";
import { sanitizeEnabledFeatures, type OptInFeatureId } from "@/lib/opt-in-features";
import { MAX_SETUP_STEPS } from "./limits";

/**
 * The guided "Set up your day" (one short flow instead of hunting through Settings): the sleep plan (wake time, sleep
 * need, wind-down length) and an optional morning routine, saved together. It is a THIN COMPOSITION of the existing
 * cores -- the plan is `saveWindDownPlanCore`, each step is `createMorningRoutineItemCore` -- so the rules (ranges, the
 * 5-step cap, label length) live in exactly one place each.
 *
 * ORDER IS THE SAFETY: validate everything first (no write on bad input), then write the plan, then the steps, and only
 * THEN switch the features on. A failure part-way leaves features OFF, so nothing half-built ever shows on Home; the plan
 * and any created steps are plain data that a retry (or Settings) simply reuses.
 */
export type DaySetupInput = {
  /** Local "HH:MM" 24-hour (the 12-hour control converts). */
  wakeTime: string;
  sleepNeedMinutes: number;
  windDownMinutes?: number;
  /** Morning routine step labels; blank ones are dropped. Empty = the routine stays off. */
  routineSteps: string[];
};

export type DaySetupResult = { plan: WindDownPlan; stepsCreated: number; featuresEnabled: OptInFeatureId[] };

export { MAX_SETUP_STEPS };

export async function setUpDayCore(supabase: SupabaseClient, userId: string, input: DaySetupInput): Promise<DaySetupResult> {
  const windDownMinutes = input.windDownMinutes ?? DEFAULT_WIND_DOWN_MINUTES;
  const invalid = validateWindDownInputs({ wakeTime: input.wakeTime, sleepNeedMinutes: input.sleepNeedMinutes, windDownMinutes });
  if (invalid) throw new Error(invalid);

  const steps = input.routineSteps.map((s) => s.trim()).filter((s) => s.length > 0);
  if (steps.length > MAX_SETUP_STEPS) throw new Error(`Add up to ${MAX_SETUP_STEPS} steps here; you can add more (up to ${MAX_ROUTINE_ITEMS}) on Home.`);
  if (steps.some((s) => s.length > 120)) throw new Error("A step can be at most 120 characters.");

  const plan = await saveWindDownPlanCore(supabase, userId, { wakeTime: input.wakeTime, sleepNeedMinutes: input.sleepNeedMinutes, windDownMinutes });

  for (const label of steps) {
    await createMorningRoutineItemCore(supabase, userId, label);
  }

  // Features LAST, and additive: never turns anything off, never drops another opt-in the user already has.
  const { data: profile, error: readError } = await supabase.from("profiles").select("enabled_features").eq("user_id", userId).maybeSingle();
  if (readError) throw readError;
  const current = sanitizeEnabledFeatures((profile?.enabled_features as string[] | null | undefined) ?? []);
  const wanted: OptInFeatureId[] = steps.length > 0 ? ["sleep_plan", "morning_routine"] : ["sleep_plan"];
  const next = [...new Set<OptInFeatureId>([...current, ...wanted])];
  const { error } = await supabase
    .from("profiles")
    .upsert({ user_id: userId, enabled_features: next } as Database["public"]["Tables"]["profiles"]["Insert"], { onConflict: "user_id" });
  if (error) throw error;

  return { plan, stepsCreated: steps.length, featuresEnabled: wanted };
}
