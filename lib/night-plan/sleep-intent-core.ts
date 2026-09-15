import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { localDateString } from "@/lib/date-utils";
import { isValidBedtime } from "@/lib/night-plan/sleep-intent";

/**
 * Cores extracted from app/(app)/close/sleep-intent-actions.ts (P4-07, same
 * R5/P4-06 rule: no requireUser()/getProfile(), timezone/now explicit). Also
 * drops that file's `untypedFrom` escape hatch (its own header: "sleep_intents
 * isn't in generated database.types.ts yet ... delete once types regenerate")
 * — migration 183 is applied and `sleep_intents` IS in database.types.ts now,
 * confirmed directly before writing this file, not assumed.
 */

export interface SleepIntentResult {
  ok: boolean;
  message: string;
}

export async function getSleepIntentCore(supabase: SupabaseClient<Database>, userId: string, dateStr: string): Promise<string | null> {
  const { data, error } = await supabase.from("sleep_intents").select("intended_bedtime").eq("user_id", userId).eq("intent_date", dateStr).maybeSingle();
  if (error || !data) return null;
  return data.intended_bedtime;
}

export async function saveSleepIntentCore(supabase: SupabaseClient<Database>, userId: string, dateStr: string, time: string): Promise<SleepIntentResult> {
  if (!isValidBedtime(time)) {
    return { ok: false, message: "Enter a time as HH:MM (24-hour), e.g. 22:30." };
  }
  const { error } = await supabase
    .from("sleep_intents")
    .upsert({ user_id: userId, intent_date: dateStr, intended_bedtime: time, updated_at: new Date().toISOString() }, { onConflict: "user_id,intent_date" });
  if (error) return { ok: false, message: "Couldn't save tonight's sleep intent. Try again." };
  return { ok: true, message: "Saved." };
}

export async function clearSleepIntentCore(supabase: SupabaseClient<Database>, userId: string, dateStr: string): Promise<SleepIntentResult> {
  const { error } = await supabase.from("sleep_intents").delete().eq("user_id", userId).eq("intent_date", dateStr);
  if (error) return { ok: false, message: "Couldn't clear tonight's sleep intent. Try again." };
  return { ok: true, message: "Cleared." };
}

/** Server-only convenience: today's local date string, explicit timezone/now — no hidden `new Date()`. */
export function todayLocalDateStringCore(now: Date, timezone: string): string {
  return localDateString(now, timezone);
}
