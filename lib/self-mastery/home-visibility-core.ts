import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reads/writes user_settings.self_mastery_on_home (migration 283). No auth/profile lookups in here (same core rule as
 * session-settings-core.ts). The READER throws on a database error and lets the caller pick the fallback: Home and Settings fall back to ON,
 * so a database without migration 283 behaves exactly as before.
 */
export async function getSelfMasteryOnHomeCore(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("user_settings").select("self_mastery_on_home").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return (data?.self_mastery_on_home as boolean | undefined) ?? true;
}

/** ENSURE THE ROW, THEN UPDATE, THEN PROVE A ROW WAS WRITTEN (user_settings rows are created lazily). */
export async function setSelfMasteryOnHomeCore(supabase: SupabaseClient, userId: string, onHome: boolean): Promise<boolean> {
  if (typeof onHome !== "boolean") throw new Error("Show Self-Mastery on Home must be true or false.");
  const ensure = await supabase.from("user_settings").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (ensure.error) throw ensure.error;
  const { data, error } = await supabase.from("user_settings").update({ self_mastery_on_home: onHome }).eq("user_id", userId).select("user_id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Your Self-Mastery on Home setting was not saved: this account has no settings row and one could not be created.");
  return onHome;
}
