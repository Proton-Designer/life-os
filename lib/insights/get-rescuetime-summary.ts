import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * P3-19 -- reads the CACHED rescuetime_daily_summaries rows (written by
 * syncRescueTimeSummaries, app/(app)/settings/rescuetime-actions.ts) for the
 * Insights panel. Never calls RescueTime live -- same "cache reads, sync
 * writes" split canvas_course_mappings already established for Canvas.
 */

export type RescueTimeInsightsRow = {
  date: string;
  productivityPulse: number | null;
  productivePct: number | null;
  distractingPct: number | null;
  totalHours: number | null;
};

export type RescueTimeInsightsData =
  | { connected: false }
  | { connected: true; lastSyncedAt: string | null; lastSyncError: string | null; rows: RescueTimeInsightsRow[] };

const DAYS_SHOWN = 14;

export async function getRescueTimeInsightsData(supabase: SupabaseClient<Database>, userId: string): Promise<RescueTimeInsightsData> {
  const { data: connection, error: connectionError } = await supabase
    .from("rescuetime_connections")
    .select("last_synced_at, last_sync_error")
    .eq("user_id", userId)
    .maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection) return { connected: false };

  const { data: summaryRows, error: summaryError } = await supabase
    .from("rescuetime_daily_summaries")
    .select("summary_date, productivity_pulse, productive_percentage, distracting_percentage, total_hours")
    .eq("user_id", userId)
    .order("summary_date", { ascending: false })
    .limit(DAYS_SHOWN);
  if (summaryError) throw summaryError;

  return {
    connected: true,
    lastSyncedAt: connection.last_synced_at,
    lastSyncError: connection.last_sync_error,
    rows: (summaryRows ?? []).map((r) => ({
      date: r.summary_date,
      productivityPulse: r.productivity_pulse,
      productivePct: r.productive_percentage,
      distractingPct: r.distracting_percentage,
      totalHours: r.total_hours,
    })),
  };
}
