import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate } from "@/lib/date-utils";
import { computeFocusTimeMinutes } from "@/lib/business/focus-time";
import { saveBusinessWeeklyGoal } from "@/app/(app)/business/actions";
import { getActiveWorkSession } from "@/lib/business/active-session";
import { KillList, type KillListSlotData } from "@/components/business/kill-list";
import { KillListModuleControls } from "@/components/business/kill-list-module-controls";
import { IncompleteTasksModule } from "@/components/business/incomplete-tasks-module";
import { getIncompleteByDate } from "@/app/(app)/business/kill-list-history-actions";
import { GoalCard } from "@/components/shared/goal-card";
import { FocusTimeCard } from "@/components/business/focus-time-card";
import type { StoredSessionHour } from "@/components/business/lock-in-session";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";

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

  const [{ data: killListRows }, { data: weeklyGoal }, anyActiveSession, { data: workSessionRows }, incompleteByDate] =
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
      getIncompleteByDate(),
    ]);

  const slots: [KillListSlotData, KillListSlotData, KillListSlotData] = [0, 1, 2].map((position) => {
    const row = killListRows?.find((r) => r.position === position);
    return { id: row?.id ?? null, text: row?.text ?? "", completed: row?.completed ?? false };
  }) as [KillListSlotData, KillListSlotData, KillListSlotData];
  const killListCompletedToday = slots.filter((s) => s.completed).length;

  // Batch 3 (C's LockInOverlayProvider refactor): session identity/kind and
  // the cross-kind guard message now come from the app-wide overlay context
  // (mounted once in AppShellChrome), not this page. All this page still
  // owns is the one thing only its own render knows: the stored hourly
  // allocations for a deep_work session that was already active when THIS
  // request rendered — a session the context knows about but that started
  // elsewhere (or is fresh) always begins at zero hours (see
  // components/business/focus-time-card.tsx).
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
        domain: (r.checkin_allocations ?? []).some((a) => a.domain === "business")
          ? ("business" as const)
          : ("wasted" as const),
      }));
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

      {/* Restructure (2026-08-26 night batch 3, per Ayman, verbatim): "put
          the lock in button inside the Focus time today module, shift the
          minute count to the left and add the lock in button on the right
          of that." The vacated cell becomes the new Incompleted Tasks
          module below. FocusTimeCard is a client component so its layout
          can react to LIVE session state (see its own doc comment). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FocusTimeCard
          sessionsTodayCount={sessionsToday.length}
          focusMinutesToday={focusMinutesToday}
          initialSessionId={initialSessionId}
          initialStoredHours={initialStoredHours}
          timezone={timezone}
        />
        <IncompleteTasksModule initialGroups={incompleteByDate} todayStr={dateStr} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div id="kill-list" className="lg:col-span-6 scroll-mt-20">
          <Panel
            title="Today's kill list"
            heroValue={`${killListCompletedToday}/3`}
            caption={killListCompletedToday === 3 ? "All three cleared" : `${3 - killListCompletedToday} left today`}
            controls={<KillListModuleControls />}
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
