import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate } from "@/lib/date-utils";
import { computeFocusTimeMinutes } from "@/lib/business/focus-time";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { saveBusinessWeeklyGoal } from "@/app/(app)/business/actions";
import { getActiveWorkSession } from "@/lib/business/active-session";
import { KillList, type KillListSlotData } from "@/components/business/kill-list";
import { KillListModuleControls } from "@/components/business/kill-list-module-controls";
import { getIncompleteThisWeek } from "@/app/(app)/business/kill-list-history-actions";
import { GoalCard } from "@/components/shared/goal-card";
import { LockInPanel, type ActiveSessionData } from "@/components/business/lock-in-panel";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import { IconChip } from "@/components/ui/icon-chip";

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
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: killListRows }, { data: weeklyGoal }, anyActiveSession, { data: workSessionRows }, incompleteThisWeek] =
    await Promise.all([
      supabase
        .from("kill_list_items")
        .select("id, position, text, completed")
        .eq("user_id", userId)
        .eq("date", dateStr)
        .order("position", { ascending: true }),
      supabase
        .from("weekly_goals")
        .select("headline, milestones")
        .eq("user_id", userId)
        .eq("domain", "business")
        .eq("week_start_date", weekStart)
        .maybeSingle(),
      // Kind-agnostic — startWorkSession's single-active-session guard
      // blocks a new session of EITHER kind while one is running, so this
      // page must know about a running Deep Study session too, even though
      // it only ever displays a Deep Work one (2026-08-24 Lead review: a
      // deep_work-only query here let this page offer a Lock In button the
      // guard would then refuse, for a session it never told the user
      // about).
      getActiveWorkSession(userId),
      // Today's focus time is the only thing this range still feeds — the
      // last-completed-session summary it also used to feed was removed
      // (2026-08-21, per Ayman: drop the "Last session: ..." line). Still
      // deep_work only — this is a Business-domain metric, unlike the guard
      // check above.
      supabase
        .from("work_sessions")
        .select("id, started_at, ended_at")
        .eq("user_id", userId)
        .eq("kind", "deep_work")
        .gte("started_at", thirtyDaysAgoIso)
        .order("started_at", { ascending: false }),
      getIncompleteThisWeek(),
    ]);

  const slots: [KillListSlotData, KillListSlotData, KillListSlotData] = [0, 1, 2].map((position) => {
    const row = killListRows?.find((r) => r.position === position);
    return { id: row?.id ?? null, text: row?.text ?? "", completed: row?.completed ?? false };
  }) as [KillListSlotData, KillListSlotData, KillListSlotData];
  const killListCompletedToday = slots.filter((s) => s.completed).length;

  let activeSession: ActiveSessionData | null = null;
  // "Deep Study in progress" — this page has no presence for that session
  // (it's Business-scoped; Deep Study surfaces solely through the Home
  // Focus module) but must still disable its own Lock In button while it's
  // running, or the guard refuses an action this page just offered.
  let otherKindActiveLabel: string | null = null;
  if (anyActiveSession?.kind === "deep_work") {
    const { data } = await supabase
      .from("checkins")
      .select("window_start, checkin_allocations(domain)")
      .eq("user_id", userId)
      .eq("work_session_id", anyActiveSession.id)
      .eq("kind", "allocation")
      .eq("answered", true)
      .order("window_start", { ascending: true });
    const storedHours = (data ?? [])
      .filter((r) => r.window_start && (r.checkin_allocations ?? []).length > 0)
      .map((r) => ({
        hourStartIso: r.window_start as string,
        domain: (r.checkin_allocations ?? []).some((a) => a.domain === "business")
          ? ("business" as const)
          : ("wasted" as const),
      }));
    activeSession = { id: anyActiveSession.id, startedAtIso: anyActiveSession.startedAt, storedHours };
  } else if (anyActiveSession?.kind === "deep_study") {
    otherKindActiveLabel = "Deep Study in progress";
  }

  // --- Focus time today ---
  const allSessions = (workSessionRows ?? []).map((s) => ({
    id: s.id,
    startedAt: new Date(s.started_at),
    endedAt: s.ended_at ? new Date(s.ended_at) : null,
  }));
  const sessionsToday = allSessions.filter((s) => localDateString(s.startedAt, timezone) === dateStr);
  const focusMinutesToday = computeFocusTimeMinutes(sessionsToday, now);

  return (
    <PageContainer>
      <PageHeader title="Business" />

      {/* Restructure (2026-08-21, per Ayman): Focus time today as a compact
          mini card — same name+metric-side-by-side shape as Home's Sector
          progress cards, not its own full Panel — sitting above the kill
          list, with the Lock In entry point right beside it. The Lock In
          Panel's own idle-state "Last session: ..." summary is gone (see
          lock-in-panel.tsx) — this is now the one at-a-glance row for
          "how much have I focused, and can I start now." */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-border/40 bg-card p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <IconChip icon={Clock} accent="business" size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">Focus time today</p>
              <p className="truncate text-xs text-muted-foreground">
                {sessionsToday.length === 0
                  ? "No Lock-In sessions yet today"
                  : `${sessionsToday.length} session${sessionsToday.length === 1 ? "" : "s"} today`}
              </p>
            </div>
          </div>
          <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
            {formatElapsedDuration(focusMinutesToday * 60_000)}
          </span>
        </div>
        <div id="lock-in-panel" className="scroll-mt-20">
          {/* showTodayTotal={false}: the mini card to the left already shows this exact number. */}
          <LockInPanel
            initialSession={activeSession}
            todayFocusMinutes={focusMinutesToday}
            timezone={timezone}
            showTodayTotal={false}
            disabledReason={otherKindActiveLabel}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div id="kill-list" className="lg:col-span-6 scroll-mt-20">
          <Panel
            title="Today's kill list"
            heroValue={`${killListCompletedToday}/3`}
            caption={killListCompletedToday === 3 ? "All three cleared" : `${3 - killListCompletedToday} left today`}
            controls={<KillListModuleControls initialIncompleteItems={incompleteThisWeek} />}
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
    </PageContainer>
  );
}
