import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToDateString, effectiveDayString, localDateString } from "@/lib/date-utils";
import { getTodayDayStart } from "@/lib/day-structure/day-start";
import { getEveningClosesForRange } from "@/lib/day-structure/closed-day";
import { computeDeltaMinutes, computeDeltaSeconds } from "@/lib/day-structure/delta-clock";
import { computeEfficiency } from "@/lib/day-structure/efficiency";
import { getHoursTodayMinutes } from "@/lib/evening-close/hours-today";
import { getTodaysTimeboxedTasks, type TimeboxedTask } from "@/lib/day-structure/timebox";
import { computeOpenDiff, type OpenDiff, type OpenRankedTask } from "@/lib/night-plan/diff-banner";
import { homeRhythmState, type RhythmState } from "@/lib/home/rhythm-state";

export type RhythmData =
  | { state: "morning"; plan: OpenRankedTask[]; diff: OpenDiff }
  | {
      state: "today";
      wokeAtIso: string;
      deltaSeconds: number;
      hoursTodayMinutes: number;
      efficiencyPercent: number | null;
      timeboxed: TimeboxedTask[];
    }
  | { state: "wind_down" }
  | { state: "done"; tomorrow: { id: string; title: string; mitRank: number }[] };

/**
 * Everything Home's rhythm section needs, reading ONLY what the active state shows (the other
 * states' queries are skipped, not fetched-then-hidden). Two cheap reads decide the state; the
 * closed day is effectiveDayString (the 4 AM rollover, same as the close), Start Day is local today.
 */
export async function getRhythmData(supabase: SupabaseClient, userId: string, now: Date, timezone: string): Promise<RhythmData> {
  const today = localDateString(now, timezone);
  const closeDay = effectiveDayString(now, timezone);
  const [dayStart, closes] = await Promise.all([
    getTodayDayStart(supabase, userId, timezone, now),
    getEveningClosesForRange(supabase, userId, closeDay, addDaysToDateString(closeDay, 1)),
  ]);
  const state: RhythmState = homeRhythmState({ now, timezone, dayStarted: dayStart !== null, closedEffectiveDay: closes.has(closeDay) });

  if (state === "wind_down") return { state };

  if (state === "done") {
    const { data } = await supabase
      .from("tasks")
      .select("id, title, mit_rank")
      .eq("user_id", userId)
      .eq("planned_date", addDaysToDateString(closeDay, 1))
      .not("mit_rank", "is", null)
      .order("mit_rank", { ascending: true });
    return { state, tomorrow: (data ?? []).map((t) => ({ id: t.id as string, title: t.title as string, mitRank: t.mit_rank as number })) };
  }

  if (state === "today" && dayStart) {
    const [hoursTodayMinutes, timeboxed] = await Promise.all([
      getHoursTodayMinutes(supabase, userId, today, timezone, now),
      getTodaysTimeboxedTasks(supabase, userId, today),
    ]);
    const efficiency = computeEfficiency(hoursTodayMinutes, computeDeltaMinutes(dayStart.wokeAtIso, now));
    return {
      state,
      wokeAtIso: dayStart.wokeAtIso,
      deltaSeconds: computeDeltaSeconds(dayStart.wokeAtIso, now),
      hoursTodayMinutes,
      efficiencyPercent: efficiency ? efficiency.percent : null,
      timeboxed,
    };
  }

  const { data } = await supabase
    .from("tasks")
    .select("id, title, mit_rank, completed")
    .eq("user_id", userId)
    .eq("planned_date", today)
    .not("mit_rank", "is", null)
    .order("mit_rank", { ascending: true });
  const plan = (data ?? []) as OpenRankedTask[];
  return { state: "morning", plan, diff: computeOpenDiff(plan) };
}
