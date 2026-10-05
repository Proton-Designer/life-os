import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString, getWeekStartDate } from "@/lib/date-utils";
import { computeFocusTimeMinutes } from "@/lib/business/focus-time";
import { getActiveWorkSession } from "@/lib/business/active-session";
import { getKillListSlots } from "@/lib/business/kill-list-slots";
import { getIncompleteByDate } from "@/app/(app)/business/kill-list-history-actions";
import { getCompletedBusinessGoals } from "@/lib/business/completed-goals";
import type { KillListSlotData } from "@/components/business/kill-list";
import type { StoredSessionHour } from "@/components/business/lock-in-session";

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
  initialSessionId: string | null;
  initialStoredHours: StoredSessionHour[];
  incompleteByDate: Awaited<ReturnType<typeof getIncompleteByDate>>;
  completedGoals: Awaited<ReturnType<typeof getCompletedBusinessGoals>>;
};

export async function loadBusinessModulesData(supabase: SupabaseClient, userId: string, now: Date, timezone: string): Promise<BusinessModulesData> {
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [slots, { data: weeklyGoal }, anyActiveSession, { data: workSessionRows }, incompleteByDate, completedGoals] = await Promise.all([
    getKillListSlots(userId, dateStr),
    supabase.from("weekly_goals").select("headline, milestones").eq("user_id", userId).eq("domain", "business").eq("week_start_date", weekStart).maybeSingle(),
    // Kind-agnostic: startWorkSession's single-active-session guard blocks a new session of EITHER kind while one runs,
    // so the page must know about a running Deep Study session too (2026-08-24 Lead review).
    getActiveWorkSession(userId),
    // Today's focus time only; still deep_work only, a Business-domain metric.
    supabase.from("work_sessions").select("id, started_at, ended_at").eq("user_id", userId).eq("kind", "deep_work").gte("started_at", thirtyDaysAgoIso).order("started_at", { ascending: false }),
    getIncompleteByDate(),
    // #53: Business's completed-goals archive reads goals(domain='business', status='done'), see lib/business/completed-goals.ts.
    getCompletedBusinessGoals(supabase, userId),
  ]);

  // Stored hourly allocations for a deep_work session already active when THIS request rendered (see focus-time-card.tsx).
  let initialStoredHours: StoredSessionHour[] = [];
  const initialSessionId = anyActiveSession?.kind === "deep_work" ? anyActiveSession.id : null;
  if (initialSessionId) {
    const { data } = await supabase
      .from("checkins")
      .select("window_start, checkin_allocations(domain)")
      .eq("user_id", userId)
      .eq("work_session_id", initialSessionId)
      .eq("kind", "allocation")
      .eq("answered", true)
      .order("window_start", { ascending: true });
    initialStoredHours = (data ?? [])
      .filter((r) => r.window_start && (r.checkin_allocations ?? []).length > 0)
      .map((r) => ({
        hourStartIso: r.window_start as string,
        domain: (r.checkin_allocations ?? []).some((a) => a.domain === "business") ? ("business" as const) : ("wasted" as const),
      }));
  }

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
    initialSessionId,
    initialStoredHours,
    incompleteByDate,
    completedGoals,
  };
}
