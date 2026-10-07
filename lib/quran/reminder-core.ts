import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateQuranReminderWindow } from "@/lib/home/quran-reminder";

/**
 * Reads/writes the Quran reminder window on user_settings (migration 261): when today's Quran portion shows on Home.
 * Both columns are NULL until set (NULL = the app default 22:00 / 01:00). No auth/profile lookups in here (same core
 * rule as lib/rhythm/wind-down-core.ts), so the Settings action and any future MCP twin share it.
 */
export type QuranReminderWindow = { start: string | null; end: string | null };

export async function getQuranReminderWindowCore(supabase: SupabaseClient, userId: string): Promise<QuranReminderWindow> {
  const { data, error } = await supabase.from("user_settings").select("quran_reminder_start, quran_reminder_end").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return { start: (data?.quran_reminder_start as string | null | undefined) ?? null, end: (data?.quran_reminder_end as string | null | undefined) ?? null };
}

/** ENSURE THE ROW, THEN UPDATE, THEN PROVE A ROW WAS WRITTEN (user_settings rows are created lazily; an UPDATE on a missing row "succeeds" with 0 rows). */
export async function saveQuranReminderWindowCore(supabase: SupabaseClient, userId: string, input: { start: string; end: string }): Promise<void> {
  const invalid = validateQuranReminderWindow(input.start, input.end);
  if (invalid) throw new Error(invalid);
  const ensure = await supabase.from("user_settings").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (ensure.error) throw ensure.error;
  const { data, error } = await supabase.from("user_settings").update({ quran_reminder_start: input.start, quran_reminder_end: input.end }).eq("user_id", userId).select("user_id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Your Quran reminder times were not saved: this account has no settings row and one could not be created.");
}
