import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * HOME-01a: the morning brief's "minimized" state, persisted per user (user_settings.morning_brief_collapsed_on,
 * migration 256). It stores the brief_date the user minimized: the brief is collapsed ONLY while today's brief_date
 * equals that value, so a newer brief shows expanded again with no cleanup job.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isCollapsedFor(collapsedOn: string | null | undefined, briefDate: string): boolean {
  return !!collapsedOn && collapsedOn === briefDate;
}

/** The reader Home uses with today's brief_date. A missing settings row reads as expanded. */
export async function isMorningBriefCollapsed(supabase: SupabaseClient, userId: string, briefDate: string): Promise<boolean> {
  const { data, error } = await supabase.from("user_settings").select("morning_brief_collapsed_on").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return isCollapsedFor(data?.morning_brief_collapsed_on as string | null | undefined, briefDate);
}

/** Absolute setter (never a toggle): collapsed=true stores this brief_date, false clears it. Ensure-row, update, prove a row changed. */
export async function setMorningBriefCollapsedCore(supabase: SupabaseClient, userId: string, briefDate: string, collapsed: boolean): Promise<void> {
  if (!DATE_RE.test(briefDate)) throw new Error("Invalid brief date.");
  const ensure = await supabase.from("user_settings").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (ensure.error) throw ensure.error;
  const { data, error } = await supabase
    .from("user_settings")
    .update({ morning_brief_collapsed_on: collapsed ? briefDate : null })
    .eq("user_id", userId)
    .select("user_id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Couldn't save that: this account has no settings row and one could not be created.");
}
