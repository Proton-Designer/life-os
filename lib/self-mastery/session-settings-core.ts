import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_DAILY_NEW_LIMIT,
  DEFAULT_SESSION_MINUTES,
  validateSelfMasterySettings,
  type SelfMasterySessionSettings,
} from "./session-settings";

/**
 * Reads/writes daily_new_limit and session_target_minutes on user_settings. No auth/profile lookups in here (same core
 * rule as lib/focus/target-core.ts) so the Settings action, and an MCP twin if one is ever added, share it.
 */
export async function getSelfMasterySettingsCore(supabase: SupabaseClient, userId: string): Promise<SelfMasterySessionSettings> {
  const { data, error } = await supabase.from("user_settings").select("daily_new_limit, session_target_minutes").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return {
    dailyNewLimit: (data?.daily_new_limit as number | undefined) ?? DEFAULT_DAILY_NEW_LIMIT,
    sessionTargetMinutes: (data?.session_target_minutes as number | undefined) ?? DEFAULT_SESSION_MINUTES,
  };
}

/** ENSURE THE ROW, THEN UPDATE, THEN PROVE A ROW WAS WRITTEN (user_settings rows are created lazily). Validates first: the database has no CHECK on the session length. */
export async function saveSelfMasterySettingsCore(
  supabase: SupabaseClient,
  userId: string,
  input: SelfMasterySessionSettings
): Promise<SelfMasterySessionSettings> {
  const invalid = validateSelfMasterySettings(input);
  if (invalid) throw new Error(invalid);
  const ensure = await supabase.from("user_settings").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (ensure.error) throw ensure.error;
  const { data, error } = await supabase
    .from("user_settings")
    .update({ daily_new_limit: input.dailyNewLimit, session_target_minutes: input.sessionTargetMinutes })
    .eq("user_id", userId)
    .select("user_id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Your Self-Mastery settings were not saved: this account has no settings row and one could not be created.");
  return { dailyNewLimit: input.dailyNewLimit, sessionTargetMinutes: input.sessionTargetMinutes };
}
