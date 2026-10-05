import type { SupabaseClient } from "@supabase/supabase-js";
import { onTimeDaysFromRows } from "@/lib/deen/prayer-streak";

const PAGE = 1000; // PostgREST's default row cap — page explicitly rather than silently truncating a long history

/**
 * Every day (ascending) on which the user prayed all five prayers on time, across their WHOLE history — what both the
 * current streak and the longest-ever streak are computed from. A lean read: only `on_time` rows, only two columns,
 * paged, so a years-long history is a handful of small requests rather than a silently capped one (the old streak read a
 * 60-day window, which would have capped any streak at 60).
 */
export async function getOnTimePrayerDays(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const rows: { date: string; prayer_name: string; status: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("prayers")
      .select("date, prayer_name, status")
      .eq("user_id", userId)
      .eq("status", "on_time")
      .order("date", { ascending: true })
      .order("prayer_name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`getOnTimePrayerDays: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < PAGE) break;
  }
  return onTimeDaysFromRows(rows);
}
