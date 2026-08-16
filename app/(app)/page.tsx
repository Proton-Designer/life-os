import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { ListChecks, Timer, Flame, Inbox } from "lucide-react";
import { getPriorityItems } from "@/lib/home/get-priority-items";
import { getDomainSnapshots } from "@/lib/home/get-domain-snapshots";
import { getHomeExtras } from "@/lib/home/get-home-extras";
import { getWeeklySignalNoiseRatio } from "@/lib/business/sn-ratio";
import {
  localDateString,
  localWeekday,
  getTimezoneOffsetMinutes,
  getWeekStartDate,
  addDaysToDateString,
  formatDurationMagnitude,
} from "@/lib/date-utils";
import { NextUpHero } from "@/components/home/next-up-hero";
import { PriorityList } from "@/components/home/priority-list";
import { DomainStatusStack } from "@/components/home/domain-status-stack";
import { DayRibbon } from "@/components/home/day-ribbon";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
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

  const [items, snapshots, extras, snRatio] = await Promise.all([
    getPriorityItems(userId, now),
    getDomainSnapshots(userId, now),
    getHomeExtras(userId, now, profile),
    getWeeklySignalNoiseRatio(userId, new Date(`${weekStart}T00:00:00Z`)),
  ]);

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

  const { done: completionDone, total: completionTotal } = extras.todayCompletion;
  const completionCaption =
    completionTotal === 0
      ? "Nothing due yet today"
      : completionDone === completionTotal
        ? "Everything done for today"
        : `${completionTotal - completionDone} item${completionTotal - completionDone === 1 ? "" : "s"} left`;
  const todayPct = completionTotal === 0 ? 0 : Math.round((completionDone / completionTotal) * 100);
  const yesterdayPct = extras.weeklyCompletionPct[5] ?? 0;
  const completionDelta =
    completionTotal === 0
      ? undefined
      : {
          direction: (todayPct > yesterdayPct ? "up" : todayPct < yesterdayPct ? "down" : "flat") as
            | "up"
            | "down"
            | "flat",
          text: `${todayPct - yesterdayPct >= 0 ? "+" : ""}${todayPct - yesterdayPct}% vs yesterday`,
        };

  const weeklyAvgPct = Math.round(
    extras.weeklyCompletionPct.reduce((a, b) => a + b, 0) / extras.weeklyCompletionPct.length
  );
  const bestDayIndex = extras.weeklyCompletionPct.reduce(
    (best, v, i) => (v > extras.weeklyCompletionPct[best] ? i : best),
    0
  );

  return (
    <PageContainer>
      <PageHeader title="Home" />

      {extras.dayRibbon ? (
        <Panel title="Today" data-panel>
          <DayRibbon layout={extras.dayRibbon} todayStr={dateStr} timezone={timezone} />
        </Panel>
      ) : (
        <Panel title="Today">
          <EmptyState
            icon={Inbox}
            message="Set your location in Settings to see today's prayer-anchored timeline"
            action={{ label: "Go to Settings", href: "/settings" }}
          />
        </Panel>
      )}

      {/* Cross-cutting Tier-1 KPI row — never per-domain (the domain status
          stack below owns that). Mobile: horizontal snap carousel at ~78vw
          so the next card peeks, matching the pattern already proven on
          the domain peek cards. */}
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-4">
        {items.length > 0 ? (
          <div className="w-[78vw] shrink-0 snap-start md:w-auto">
            <NextUpHero
              item={items[0]}
              now={now}
              caption={items.length > 1 ? `${items.length - 1} more today` : "Last one for today"}
            />
          </div>
        ) : (
          <div className="w-[78vw] shrink-0 snap-start md:w-auto">
            <EmptyState
              icon={ListChecks}
              message={isFreshInstall ? "Welcome — head into a domain tab to get started" : "You're all clear"}
              action={{ label: "Plan the week", href: "/weekly-planning" }}
            />
          </div>
        )}
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={ListChecks}
            accent="info"
            label="Today's completion"
            value={completionTotal === 0 ? "—" : `${completionDone}/${completionTotal}`}
            caption={completionCaption}
            delta={completionDelta}
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={Timer}
            accent="business"
            label="Focus time today"
            value={extras.focusTimeMinutes === 0 ? "0m" : formatDurationMagnitude(extras.focusTimeMinutes)}
            caption={
              extras.focusSessionCount === 0
                ? "No Lock-In sessions yet today"
                : `${extras.focusSessionCount} Lock-In session${extras.focusSessionCount === 1 ? "" : "s"}`
            }
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={Flame}
            accent="deen"
            label="Prayer streak"
            value={`${extras.prayerStreak}`}
            caption={
              extras.prayerStreak === 0
                ? "Pray all 5 today to start one"
                : extras.prayerStreak === 1
                  ? "Just getting started"
                  : "Keep it going"
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Panel title="Right now / Later today" data-panel>
            {showPlanningNudge && (
              <Link
                href="/weekly-planning"
                className="mb-4 block rounded-lg border border-accent-business/40 bg-accent-business/10 px-4 py-3 text-sm text-accent-business hover:bg-accent-business/20"
              >
                Plan next week&apos;s Deen and Business goals →
              </Link>
            )}
            <PriorityList items={items} />
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <DomainStatusStack snapshots={snapshots} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Panel
            title="This week"
            heroValue={`${weeklyAvgPct}%`}
            caption={`${extras.weeklyCompletionLabels[bestDayIndex]} was your best day this week`}
            data-panel
          >
            <AreaChart
              categories={extras.weeklyCompletionLabels}
              series={[{ label: "Completion", colorVar: "--series-business", values: extras.weeklyCompletionPct }]}
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
            <Panel title="Signal:Noise this week" data-panel>
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
