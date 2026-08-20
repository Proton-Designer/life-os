import { redirect } from "next/navigation";
import { Clock, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";
import { computeFocusTimeMinutes } from "@/lib/business/focus-time";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { countDaysCleared } from "@/lib/business/kill-list-cleared";
import { resolveSessionHours } from "@/lib/checkins/session-hour-status";
import { saveBusinessWeeklyGoal } from "@/app/(app)/business/actions";
import { KillList, type KillListSlotData } from "@/components/business/kill-list";
import { GoalCard } from "@/components/shared/goal-card";
import { LockInPanel, type ActiveSessionData, type LastSessionData } from "@/components/business/lock-in-panel";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Panel } from "@/components/ui/panel";
import { accentForActivityCount } from "@/lib/kpi-value-accent";

export default async function BusinessPage() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);
  const sevenDaysAgoStr = addDaysToDateString(dateStr, -6);
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: killListRows },
    { data: sevenDayKillListRows },
    { data: weeklyGoal },
    { data: activeSessionRow },
    { data: workSessionRows },
  ] = await Promise.all([
    supabase
      .from("kill_list_items")
      .select("id, position, text, completed")
      .eq("user_id", userId)
      .eq("date", dateStr)
      .order("position", { ascending: true }),
    supabase.from("kill_list_items").select("date, completed").eq("user_id", userId).gte("date", sevenDaysAgoStr),
    supabase
      .from("weekly_goals")
      .select("headline, milestones")
      .eq("user_id", userId)
      .eq("domain", "business")
      .eq("week_start_date", weekStart)
      .maybeSingle(),
    supabase.from("work_sessions").select("id, started_at").eq("user_id", userId).is("ended_at", null).maybeSingle(),
    // One 30-day range serves today's focus time, this week's session
    // count, and the most recent completed session — sliced in memory.
    supabase
      .from("work_sessions")
      .select("id, started_at, ended_at")
      .eq("user_id", userId)
      .gte("started_at", thirtyDaysAgoIso)
      .order("started_at", { ascending: false }),
  ]);

  const slots: [KillListSlotData, KillListSlotData, KillListSlotData] = [0, 1, 2].map((position) => {
    const row = killListRows?.find((r) => r.position === position);
    return { id: row?.id ?? null, text: row?.text ?? "", completed: row?.completed ?? false };
  }) as [KillListSlotData, KillListSlotData, KillListSlotData];
  const killListCompletedToday = slots.filter((s) => s.completed).length;

  /**
   * Shared by the active session and the last-completed one — one hourly
   * Lock-In confirm/edit is exactly one checkins row (kind='allocation',
   * answered=true) joined to its one checkin_allocations row. Session
   * ratio and the missed-hour derivation both read this same stored shape
   * now (2026-08-19); there's no separate point-sample query to keep in
   * sync anymore.
   */
  async function fetchStoredHours(sessionId: string) {
    const { data } = await supabase
      .from("checkins")
      .select("window_start, checkin_allocations(domain)")
      .eq("user_id", userId)
      .eq("work_session_id", sessionId)
      .eq("kind", "allocation")
      .eq("answered", true)
      .order("window_start", { ascending: true });

    return (data ?? [])
      .filter((r) => r.window_start && (r.checkin_allocations ?? []).length > 0)
      .map((r) => ({
        hourStartIso: r.window_start as string,
        domain: (r.checkin_allocations ?? []).some((a) => a.domain === "business")
          ? ("business" as const)
          : ("wasted" as const),
      }));
  }

  let activeSession: ActiveSessionData | null = null;
  if (activeSessionRow) {
    activeSession = {
      id: activeSessionRow.id,
      startedAtIso: activeSessionRow.started_at,
      storedHours: await fetchStoredHours(activeSessionRow.id),
    };
  }

  // --- Focus time today / sessions this week / last completed session ---
  const allSessions = (workSessionRows ?? []).map((s) => ({
    id: s.id,
    startedAt: new Date(s.started_at),
    endedAt: s.ended_at ? new Date(s.ended_at) : null,
  }));
  const sessionsToday = allSessions.filter((s) => localDateString(s.startedAt, timezone) === dateStr);
  const focusMinutesToday = computeFocusTimeMinutes(sessionsToday, now);
  const completedSessions = allSessions
    .filter((s): s is { id: string; startedAt: Date; endedAt: Date } => s.endedAt !== null)
    .sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime());

  let lastSession: LastSessionData | null = null;
  const lastCompleted = completedSessions[0];
  if (lastCompleted) {
    const storedHours = await fetchStoredHours(lastCompleted.id);
    lastSession = {
      sessionId: lastCompleted.id,
      startedAtIso: lastCompleted.startedAt.toISOString(),
      endedAtIso: lastCompleted.endedAt.toISOString(),
      resolvedHours: resolveSessionHours(
        { startedAt: lastCompleted.startedAt, endedAt: lastCompleted.endedAt },
        60,
        lastCompleted.endedAt,
        storedHours
      ),
    };
  }

  // --- Days cleared, last 7 days ---
  const daysCleared = countDaysCleared(sevenDayKillListRows ?? []);

  return (
    <PageContainer>
      <PageHeader title="Business" />

      {/* Overnight restructure (2026-08-18 brief §2.1) — Ayman's own
          proposed order, built as specified. He explicitly framed it as a
          best guess ("I always think there's something that can do
          better"), not a final answer — a brainstorm using tonight's
          research is expected to revisit this. "Sessions this week" is
          removed outright, per his instruction. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div id="kill-list" className="lg:col-span-6 scroll-mt-20">
          <Panel
            title="Today's kill list"
            heroValue={`${killListCompletedToday}/3`}
            caption={killListCompletedToday === 3 ? "All three cleared" : `${3 - killListCompletedToday} left today`}
          >
            <KillList date={dateStr} slots={slots} />
          </Panel>
        </div>
        <div className="lg:col-span-6">
          <GoalCard
            title="This week's goal"
            domain="business"
            headline={weeklyGoal?.headline ?? ""}
            milestones={(weeklyGoal?.milestones as string[] | null) ?? []}
            locked={false}
            onSave={saveBusinessWeeklyGoal.bind(null, weekStart)}
            emptyStateFraming={
              <>The one outcome this week is actually about — everything else should serve it.</>
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <KpiCard
            icon={Clock}
            accent="business"
            label="Focus time today"
            value={formatElapsedDuration(focusMinutesToday * 60_000)}
            caption={
              sessionsToday.length === 0
                ? "No Lock-In sessions yet today"
                : `${sessionsToday.length} session${sessionsToday.length === 1 ? "" : "s"} today`
            }
          />
        </div>
        <div id="lock-in-panel" className="lg:col-span-8 scroll-mt-20">
          <Panel title="Lock In">
            {/* showTodayTotal={false}: the Focus-time-today card directly
                above already shows this exact number — see LockInPanel's
                own comment on the flag. */}
            <LockInPanel
              initialSession={activeSession}
              lastSession={lastSession}
              todayFocusMinutes={focusMinutesToday}
              timezone={timezone}
              showTodayTotal={false}
            />
          </Panel>
        </div>
      </div>

      {/* Signal:Noise moved to Insights (2026-08-19, Phase 4 of the
          check-in allocation system) — once it counts every domain
          (Deen/Business signal vs. School/Fitness/Co-op/Wasted noise), a
          Business-page-only widget misrepresents what it measures. */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <KpiCard
          icon={CheckCircle2}
          accent={accentForActivityCount(daysCleared)}
          label="Days cleared"
          value={`${daysCleared}/7`}
          caption={
            daysCleared === 7
              ? "Perfect week — every kill list cleared"
              : daysCleared === 0
                ? "No fully cleared days in the last 7"
                : "Keep clearing all 3 daily"
          }
        />
      </div>
    </PageContainer>
  );
}
