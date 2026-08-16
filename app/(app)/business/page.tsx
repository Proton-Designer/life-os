import { redirect } from "next/navigation";
import { Clock, ListChecks, CheckCircle2, Radar } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";
import { computeFocusTimeMinutes } from "@/lib/business/focus-time";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { countDaysCleared } from "@/lib/business/kill-list-cleared";
import { bucketSignalNoiseByWeek, type WeekBoundary } from "@/lib/business/sn-trend";
import { saveBusinessWeeklyGoal } from "@/app/(app)/business/actions";
import { KillList, type KillListSlotData } from "@/components/business/kill-list";
import { GoalCard } from "@/components/shared/goal-card";
import { LockInPanel, type ActiveSessionData, type LastSessionData } from "@/components/business/lock-in-panel";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { BarChart } from "@/components/charts/bar-chart";
import { accentForActivityCount } from "@/lib/kpi-value-accent";

const SN_WEEK_COUNT = 6;

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
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysToDateString(weekStart, i));
  const sevenDaysAgoStr = addDaysToDateString(dateStr, -6);
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const snWeekStarts = Array.from({ length: SN_WEEK_COUNT }, (_, i) =>
    addDaysToDateString(weekStart, -7 * (SN_WEEK_COUNT - 1 - i))
  );
  const snWeeks: WeekBoundary[] = snWeekStarts.map((ws) => ({
    weekStartIso: `${ws}T00:00:00.000Z`,
    weekEndIso: `${addDaysToDateString(ws, 7)}T00:00:00.000Z`,
    label: new Date(`${ws}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  }));

  const [
    { data: killListRows },
    { data: sevenDayKillListRows },
    { data: weeklyGoal },
    { data: activeSessionRow },
    { data: workSessionRows },
    { data: checkinRows },
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
    supabase
      .from("checkins")
      .select("checkin_time, tag_type, answered")
      .eq("user_id", userId)
      .gte("checkin_time", snWeeks[0].weekStartIso),
  ]);

  const slots: [KillListSlotData, KillListSlotData, KillListSlotData] = [0, 1, 2].map((position) => {
    const row = killListRows?.find((r) => r.position === position);
    return { id: row?.id ?? null, text: row?.text ?? "", completed: row?.completed ?? false };
  }) as [KillListSlotData, KillListSlotData, KillListSlotData];
  const killListCompletedToday = slots.filter((s) => s.completed).length;

  let activeSession: ActiveSessionData | null = null;
  if (activeSessionRow) {
    const { data: sessionCheckins } = await supabase
      .from("checkins")
      .select("checkin_time, tag_type, tag_label, answered")
      .eq("user_id", userId)
      .eq("work_session_id", activeSessionRow.id)
      .order("checkin_time", { ascending: true });
    activeSession = {
      id: activeSessionRow.id,
      startedAtIso: activeSessionRow.started_at,
      checkins: (sessionCheckins ?? []).map((c) => ({
        checkinTime: c.checkin_time,
        tagType: c.tag_type,
        tagLabel: c.tag_label,
        answered: c.answered,
      })),
    };
  }

  // --- Focus time today / sessions this week / last completed session ---
  const allSessions = (workSessionRows ?? []).map((s) => ({
    startedAt: new Date(s.started_at),
    endedAt: s.ended_at ? new Date(s.ended_at) : null,
  }));
  const sessionsToday = allSessions.filter((s) => localDateString(s.startedAt, timezone) === dateStr);
  const focusMinutesToday = computeFocusTimeMinutes(sessionsToday, now);
  const sessionsThisWeek = allSessions.filter((s) => weekDates.includes(localDateString(s.startedAt, timezone)));
  const completedSessions = allSessions
    .filter((s): s is { startedAt: Date; endedAt: Date } => s.endedAt !== null)
    .sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime());
  const lastSession: LastSessionData | null = completedSessions[0]
    ? { startedAtIso: completedSessions[0].startedAt.toISOString(), endedAtIso: completedSessions[0].endedAt.toISOString() }
    : null;

  // --- Days cleared, last 7 days ---
  const daysCleared = countDaysCleared(sevenDayKillListRows ?? []);

  // --- Signal:Noise by week ---
  const snWeeklyData = bucketSignalNoiseByWeek(checkinRows ?? [], snWeeks);
  const thisWeekSn = snWeeklyData[snWeeklyData.length - 1];
  const snBars = snWeeklyData.map((w) => ({
    label: w.label,
    value: w.noise === 0 ? w.signal : Math.round((w.signal / w.noise) * 10) / 10,
  }));
  const hasAnySnActivity = snWeeklyData.some((w) => w.signal + w.noise > 0);

  return (
    <PageContainer>
      <PageHeader title="Business" />

      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-3">
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={Clock}
            accent={accentForActivityCount(sessionsToday.length)}
            label="Focus time today"
            value={formatElapsedDuration(focusMinutesToday * 60_000)}
            caption={
              sessionsToday.length === 0
                ? "No Lock-In sessions yet today"
                : `${sessionsToday.length} session${sessionsToday.length === 1 ? "" : "s"} today`
            }
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={ListChecks}
            accent={accentForActivityCount(sessionsThisWeek.length)}
            label="Sessions this week"
            value={`${sessionsThisWeek.length}`}
            caption={
              sessionsThisWeek.length === 0
                ? "Lock in to start your first session"
                : `${formatElapsedDuration(computeFocusTimeMinutes(sessionsThisWeek, now) * 60_000)} total`
            }
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
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
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div id="lock-in-panel" className="lg:col-span-7">
          <Panel title="Lock In">
            <LockInPanel initialSession={activeSession} lastSession={lastSession} todayFocusMinutes={focusMinutesToday} />
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <GoalCard
            title="This week's goal"
            domain="business"
            headline={weeklyGoal?.headline ?? ""}
            milestones={(weeklyGoal?.milestones as string[] | null) ?? []}
            locked={false}
            onSave={saveBusinessWeeklyGoal.bind(null, weekStart)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <Panel
            title="Today's kill list"
            heroValue={`${killListCompletedToday}/3`}
            caption={killListCompletedToday === 3 ? "All three cleared" : `${3 - killListCompletedToday} left today`}
          >
            <KillList date={dateStr} slots={slots} />
          </Panel>
        </div>
        <div className="lg:col-span-6">
          {hasAnySnActivity ? (
            <Panel
              title="Signal:Noise by week"
              heroValue={thisWeekSn.display}
              caption="kill-list vs. noise check-ins, this week vs. the last 6"
            >
              <BarChart bars={snBars} colorVar="--series-business" highlightIndex={snBars.length - 1} />
            </Panel>
          ) : (
            <Panel title="Signal:Noise by week">
              <EmptyState
                icon={Radar}
                message="No check-ins answered yet in the last 6 weeks"
                action={{ label: "Lock in to start tracking", href: "#lock-in-panel" }}
              />
            </Panel>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
