import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { focusTargetMinutes, validateFocusTargets, type FocusTargetSettings } from "@/lib/focus/target";

/**
 * Reads/writes the focus targets on user_settings (migration 256). No auth/profile lookups in here
 * (same core rule as lib/rhythm/wind-down-core.ts) so the Settings action and any MCP twin share it.
 */
export async function getFocusTargetSettingsCore(supabase: SupabaseClient, userId: string): Promise<FocusTargetSettings> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("daily_focus_target_minutes, weekend_focus_target_minutes")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return {
    dailyMinutes: (data?.daily_focus_target_minutes as number | null | undefined) ?? null,
    weekendMinutes: (data?.weekend_focus_target_minutes as number | null | undefined) ?? null,
  };
}

/**
 * The one reader Home / the evening close / the weekly review use: the target IN MINUTES for the
 * user's local date. `localDate` must already be resolved in their timezone (lib/date-utils).
 */
export async function loadFocusTargetMinutes(supabase: SupabaseClient, userId: string, localDate: string): Promise<number> {
  return focusTargetMinutes(await getFocusTargetSettingsCore(supabase, userId), localDate);
}

/** ENSURE THE ROW, THEN UPDATE, THEN PROVE A ROW WAS WRITTEN (user_settings rows are created lazily). Absolute values: null clears. */
export async function saveFocusTargetsCore(supabase: SupabaseClient, userId: string, input: FocusTargetSettings): Promise<FocusTargetSettings> {
  const invalid = validateFocusTargets(input);
  if (invalid) throw new Error(invalid);
  const ensure = await supabase.from("user_settings").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (ensure.error) throw ensure.error;
  const { data, error } = await supabase
    .from("user_settings")
    .update({ daily_focus_target_minutes: input.dailyMinutes, weekend_focus_target_minutes: input.weekendMinutes })
    .eq("user_id", userId)
    .select("user_id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Your focus target was not saved: this account has no settings row and one could not be created.");
  return { dailyMinutes: input.dailyMinutes, weekendMinutes: input.weekendMinutes };
}
