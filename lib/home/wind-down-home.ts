import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWindDownSettingsCore, type WindDownSettings } from "@/lib/rhythm/wind-down-core";
import { eveningWindDownStart } from "@/lib/rhythm/wind-down";

/** What Home needs from the wind-down plan, or null while Sleep plan is OFF (nothing is read then). */
export type HomeWindDown = { settings: WindDownSettings; windDownStart: string | undefined; bedtime: string | null };

/**
 * ONE helper for every surface that follows the wind-down plan (Home's rhythm card, its "Lights out
 * by" line, the topbar moon link): the plan is read ONLY when the sleep_plan opt-in is ON; the start
 * is the plan's evening wind-down start (15:00-23:59) or undefined, which callers read as the 21:00
 * default. Sleep plan OFF returns null without a query.
 */
export async function loadHomeWindDown(supabase: SupabaseClient, userId: string, sleepPlanOn: boolean): Promise<HomeWindDown | null> {
  if (!sleepPlanOn) return null;
  const settings = await getWindDownSettingsCore(supabase, userId);
  return { settings, windDownStart: eveningWindDownStart(settings.plan) ?? undefined, bedtime: settings.plan?.bedtime ?? null };
}
