import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString, getWeekStartDate } from "@/lib/date-utils";
import { computeFocusTimeMinutes } from "@/lib/business/focus-time";
import { getKillListSlots } from "@/lib/business/kill-list-slots";
import { getIncompleteByDate } from "@/app/(app)/business/kill-list-history-actions";
import { getCompletedBusinessGoals } from "@/lib/business/completed-goals";
import type { KillListSlotData } from "@/components/business/kill-list";

/**
 * Everything the Business modules (focus time, incomplete tasks, kill list, weekly goal, completed goals) render,
 * as plain serializable data. Extracted from BusinessPageContent so the SAME modules can also be switched on in the
 * Work page's widget manager (they are off there by default) without a second implementation of each one.
 */
export type BusinessModulesData = {
  dateStr: string;
  timezone: string;
  slots: [KillListSlotData, KillListSlotData, KillListSlotData];
  weeklyGoal: { headline: string; milestones: string[] };
  sessionsTodayCount: number;
  focusMinutesToday: number;
  incompleteByDate: Awaited<ReturnType<typeof getIncompleteByDate>>;
  completedGoals: Awaited<ReturnType<typeof getCompletedBusinessGoals>>;
};

export async function loadBusinessModulesData(supabase: SupabaseClient, userId: string, now: Date, timezone: string): Promise<BusinessModulesData> {
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [slots, { data: weeklyGoal }, { data: workSessionRows }, incompleteByDate, completedGoals] = await Promise.all([
    getKillListSlots(userId, dateStr),
    supabase.from("weekly_goals").select("headline, milestones").eq("user_id", userId).eq("domain", "business").eq("week_start_date", weekStart).maybeSingle(),
    // Today's focus time only; still deep_work only, a Business-domain metric.
    supabase.from("work_sessions").select("id, started_at, ended_at").eq("user_id", userId).eq("kind", "deep_work").gte("started_at", thirtyDaysAgoIso).order("started_at", { ascending: false }),
    getIncompleteByDate(),
    // #53: Business's completed-goals archive reads goals(domain='business', status='done'), see lib/business/completed-goals.ts.
    getCompletedBusinessGoals(supabase, userId),
  ]);

  const sessionsToday = (workSessionRows ?? [])
    .map((s) => ({ id: s.id, startedAt: new Date(s.started_at), endedAt: s.ended_at ? new Date(s.ended_at) : null }))
    .filter((s) => localDateString(s.startedAt, timezone) === dateStr);

  return {
    dateStr,
    timezone,
    slots,
    weeklyGoal: { headline: weeklyGoal?.headline ?? "", milestones: (weeklyGoal?.milestones as string[] | null) ?? [] },
    sessionsTodayCount: sessionsToday.length,
    focusMinutesToday: computeFocusTimeMinutes(sessionsToday, now),
    incompleteByDate,
    completedGoals,
  };
}
