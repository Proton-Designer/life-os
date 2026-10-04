import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveWindDown, validateWindDownInputs, DEFAULT_WIND_DOWN_MINUTES, type WindDownInputs, type WindDownPlan } from "@/lib/rhythm/wind-down";

/**
 * Reads/writes the set-once wind-down plan on user_settings (migration 253). No auth/profile
 * lookups in here (same core rule as lib/settings/actions-core.ts) so the Settings action and any
 * future MCP twin share it. The columns are NULL until set; deriveWindDown turns them into
 * bedtime + wind-down start (never stored).
 */
export type WindDownSettings = WindDownInputs & { plan: WindDownPlan | null };

export async function getWindDownSettingsCore(supabase: SupabaseClient, userId: string): Promise<WindDownSettings> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("wake_time, sleep_need_minutes, wind_down_minutes")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const inputs: WindDownInputs = {
    wakeTime: (data?.wake_time as string | null | undefined) ?? null,
    sleepNeedMinutes: (data?.sleep_need_minutes as number | null | undefined) ?? null,
    windDownMinutes: (data?.wind_down_minutes as number | null | undefined) ?? null,
  };
  return { ...inputs, plan: deriveWindDown(inputs) };
}

/**
 * ENSURE THE ROW, THEN UPDATE, THEN PROVE A ROW WAS WRITTEN — user_settings rows are created
 * lazily (see writeWeekdayBaselines, P4-23: an UPDATE against a missing row "succeeds" with 0 rows).
 */
export async function saveWindDownPlanCore(
  supabase: SupabaseClient,
  userId: string,
  input: { wakeTime: string; sleepNeedMinutes: number; windDownMinutes?: number }
): Promise<WindDownPlan> {
  const windDownMinutes = input.windDownMinutes ?? DEFAULT_WIND_DOWN_MINUTES;
  const invalid = validateWindDownInputs({ wakeTime: input.wakeTime, sleepNeedMinutes: input.sleepNeedMinutes, windDownMinutes });
  if (invalid) throw new Error(invalid);

  const ensure = await supabase.from("user_settings").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (ensure.error) throw ensure.error;
  const { data, error } = await supabase
    .from("user_settings")
    .update({ wake_time: input.wakeTime, sleep_need_minutes: input.sleepNeedMinutes, wind_down_minutes: windDownMinutes })
    .eq("user_id", userId)
    .select("user_id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Your wind-down plan was not saved: this account has no settings row and one could not be created.");
  return deriveWindDown({ wakeTime: input.wakeTime, sleepNeedMinutes: input.sleepNeedMinutes, windDownMinutes })!;
}
