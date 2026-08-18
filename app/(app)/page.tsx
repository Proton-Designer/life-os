import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { Inbox } from "lucide-react";
import { getPriorityItems } from "@/lib/home/get-priority-items";
import { getDomainSnapshots } from "@/lib/home/get-domain-snapshots";
import { getHomeExtras } from "@/lib/home/get-home-extras";
import { getWeeklySignalNoiseRatio } from "@/lib/business/sn-ratio";
import { getActiveWorkSession } from "@/lib/business/active-session";
import {
  localDateString,
  localWeekday,
  getTimezoneOffsetMinutes,
  getWeekStartDate,
  addDaysToDateString,
} from "@/lib/date-utils";
import { NextActions } from "@/components/home/next-actions";
import { FocusModule } from "@/components/home/focus-module";
import { WeeklyFocus } from "@/components/home/weekly-focus";
import { PriorityList } from "@/components/home/priority-list";
import { DomainStatusStack } from "@/components/home/domain-status-stack";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { AreaChart } from "@/components/charts/area-chart";
import { DonutChart } from "@/components/charts/donut-chart";

export default async function HomePage() {
  const supabase = await createClient();
  const user = await getAuthedUser();

  // app/(app)/layout.tsx also gates on this, but layout and page data-fetching
  // can run independently (e.g. an unauthenticated request with no session
  // cookie) — guard here too rather than assuming user is always non-null.
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const dateStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(dateStr);

  const [items, snapshots, extras, snRatio, weeklyGoalsResult, activeSession] = await Promise.all([
    getPriorityItems(userId, now),
    getDomainSnapshots(userId, now),
    getHomeExtras(userId, now, profile),
    getWeeklySignalNoiseRatio(userId, new Date(`${weekStart}T00:00:00Z`)),
    supabase
      .from("weekly_goals")
      .select("domain, headline, milestones, quran_page_target")
      .eq("user_id", userId)
      .eq("week_start_date", weekStart)
      .in("domain", ["deen", "business"]),
    getActiveWorkSession(userId),
  ]);
  const weeklyGoalsRows = weeklyGoalsResult.data ?? [];
  const deenGoalRow = weeklyGoalsRows.find((g) => g.domain === "deen") ?? null;
  const businessGoalRow = weeklyGoalsRows.find((g) => g.domain === "business") ?? null;
  const deenGoal = deenGoalRow
    ? {
        headline: deenGoalRow.headline,
        milestones: (deenGoalRow.milestones as string[] | null) ?? [],
        quranPages: snapshots.deen.quranWeekPages,
        quranTarget: snapshots.deen.quranWeeklyTarget,
      }
    : null;
  const businessGoal = businessGoalRow
    ? {
        headline: businessGoalRow.headline,
        milestones: (businessGoalRow.milestones as string[] | null) ?? [],
      }
    : null;

  // Onboarding (Phase 13) doesn't exist yet — until it does, a fresh account
  // just sees the same empty state as "all clear" with a slightly different
  // message, rather than a 404 redirect to a route that isn't built.
  const isFreshInstall = profile?.onboarding_completed === false && items.length === 0;

  // Weekly planning nudge: unlocks Saturday evening, no hard lockout — just
  // a nudge until it's done, per spec. "This week" here means the upcoming
  // week (starts tomorrow, Sunday), since Saturday evening is when you plan
  // ahead for it.
  const isSaturdayEvening =
    localWeekday(now, timezone) === "Saturday" &&
    (now.getUTCHours() * 60 + now.getUTCMinutes() + getTimezoneOffsetMinutes(now, timezone)) % 1440 >= 18 * 60;
  let showPlanningNudge = false;
  if (isSaturdayEvening) {
    const upcomingWeekStart = addDaysToDateString(getWeekStartDate(dateStr), 7);
    const { data: upcomingGoals } = await supabase
      .from("weekly_goals")
      .select("id")
      .eq("user_id", userId)
      .eq("week_start_date", upcomingWeekStart);
    showPlanningNudge = (upcomingGoals?.length ?? 0) === 0;
  }

  const weeklyAvgPct = Math.round(
    extras.weeklyCompletionPct.reduce((a, b) => a + b, 0) / extras.weeklyCompletionPct.length
  );
  const bestDayIndex = extras.weeklyCompletionPct.reduce(
    (best, v, i) => (v > extras.weeklyCompletionPct[best] ? i : best),
    0
  );

  const activeSessionForFocusModule = activeSession
    ? { id: activeSession.id, startedAtIso: activeSession.startedAt }
    : null;

  return (
    <PageContainer>
      <PageHeader title="Home" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Panel title="Now">
            <NextActions items={items} isFreshInstall={isFreshInstall} nowIso={now.toISOString()} />
          </Panel>
        </div>
        <div className="lg:col-span-4">
          <Panel title="Focus">
            <FocusModule
              focusMinutesToday={extras.focusTimeMinutes}
              sessionCount={extras.focusSessionCount}
              activeSession={activeSessionForFocusModule}
            />
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Panel title="This week's focus">
            <WeeklyFocus deen={deenGoal} business={businessGoal} showPlanningNudge={showPlanningNudge} />
          </Panel>
        </div>
        <div className="lg:col-span-4">
          <DomainStatusStack snapshots={snapshots} title="Sector progress" />
        </div>
      </div>

      <Panel title="Right now / Later today">
        <PriorityList items={items} />
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Panel
            title="This week"
            heroValue={`${weeklyAvgPct}%`}
            caption={`${extras.weeklyCompletionLabels[bestDayIndex]} was your best day this week`}
          >
            <AreaChart
              categories={extras.weeklyCompletionLabels}
              series={[{ label: "Completion", colorVar: "--series-business", values: extras.weeklyCompletionPct }]}
              unit="%"
            />
          </Panel>
        </div>
        <div className="lg:col-span-4">
          {snRatio.signal + snRatio.noise === 0 ? (
            <Panel title="Signal:Noise this week">
              <EmptyState
                icon={Inbox}
                message="No check-ins answered yet this week"
                action={{ label: "Start a Lock-In session", href: "/business" }}
              />
            </Panel>
          ) : (
            <Panel title="Signal:Noise this week">
              <DonutChart
                slices={[
                  { label: "Signal", value: snRatio.signal, colorVar: "--accent-business" },
                  { label: "Noise", value: snRatio.noise, colorVar: "--accent-noise" },
                ]}
                centerLabel="This week"
                centerValue={snRatio.display}
              />
            </Panel>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
