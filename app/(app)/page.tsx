import { redirect } from "next/navigation";
import { hasArea } from "@/lib/domains/area-vocabulary";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { Inbox } from "lucide-react";
import { getPriorityItems, getCompletedItemsToday } from "@/lib/home/get-priority-items";
import { getDomainSnapshots } from "@/lib/home/get-domain-snapshots";
import { getHomeExtras } from "@/lib/home/get-home-extras";
import { getDayShape } from "@/lib/home/get-day-shape";
import { computeDayRibbon } from "@/lib/home/day-ribbon";
import { getAllTriggers, getTodayDistractionCount } from "@/lib/distractions/queries";
import { localDateString, localWeekday, getTimezoneOffsetMinutes, getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";
import { NextActions } from "@/components/home/next-actions";
import { FocusModule } from "@/components/home/focus-module";
import { WeeklyGoalsHeader } from "@/components/shared/weekly-goals-header";
import { DomainStatusStack } from "@/components/home/domain-status-stack";
import { DayRibbon } from "@/components/home/day-ribbon";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { InProgressBanner } from "@/components/shell/in-progress-banner";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { saveWeeklyGoal } from "@/app/(app)/actions";
import { getInProgressBooks } from "@/lib/self-mastery/get-in-progress-books";
import { getDueSummary } from "@/app/(app)/personal/self-mastery-session-actions";
import { SessionEntryCard } from "@/components/self-mastery/session/session-entry-card";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { weeklyGoalDomains } from "@/lib/domains/weekly-goal-domains";
import { computeDomainVisibility } from "@/lib/home/compute-domain-visibility";

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

  // Fetched ahead of the Promise.all below (not inside it) because the
  // weekly_goals query's own domain filter now depends on its resolved
  // value — see weeklyGoalDomains' own header for why ["deen","business"]
  // silently excludes any user who deselected Faith the moment that
  // becomes possible. cache()-wrapped, so this costs nothing extra where
  // getUserDomains() is called again below for hasSelfMastery/visibility.
  const domainsState = await getUserDomains();

  const [items, completedToday, snapshots, extras, dayShape, weeklyGoalsResult, triggers, distractionsToday, inProgressItems, dueSummary] =
    await Promise.all([
      getPriorityItems(userId, now),
      getCompletedItemsToday(userId, now),
      getDomainSnapshots(userId, now),
      getHomeExtras(userId, now, profile),
      getDayShape(userId, now),
      supabase
        .from("weekly_goals")
        .select("domain, headline, milestones, quran_page_target")
        .eq("user_id", userId)
        .eq("week_start_date", weekStart)
        .in("domain", weeklyGoalDomains(domainsState)),
      getAllTriggers(supabase, userId, dateStr),
      getTodayDistractionCount(supabase, userId, dateStr),
      // D-004: a lightweight "this is still happening" affordance for
      // long-running work — Self-Mastery's book ingestion today, School's
      // syllabus parsing can produce the same InProgressItem[] shape later.
      // Degrades to [] rather than throwing if the Self-Mastery schema
      // isn't deployed yet (see the function's own comment) — Home must
      // never break because a feature's migration hasn't landed.
      getInProgressBooks(),
      // D-003: the retrieval session's entry point. Deliberately does NOT
      // call start_session — a user glancing at Home never creates a real
      // work_sessions row just by loading the page.
      getDueSummary(),
    ]);

  // Via the 115 bridge — reading "personal_growth:self_mastery" directly
  // makes Self-Mastery disappear the moment the group row is archived.
  const hasSelfMastery = hasArea(domainsState, "learning");

  // Body-level gating (Opus Lead finding, stranger-journey e2e): the nav
  // gates correctly, but Home's own content did not — Sector progress and
  // This Week's Focus previously rendered all 5 legacy domains
  // unconditionally, advertising domains a user explicitly declined during
  // onboarding. See compute-domain-visibility.ts for the M6-guarantee
  // reasoning (a legacy account sees every flag true) — extracted to a
  // pure function specifically so that guarantee is unit-tested directly,
  // not just implied by this page rendering correctly in practice.
  const { hasFaith, hasFitness, hasWork, hasSchoolDomain } = computeDomainVisibility(domainsState);

  // Canonical order preserved (deen, business, fitness, school, co_op) —
  // for a legacy account every flag above is true, so this filter is a
  // structural no-op and the array comes out byte-identical to the
  // hardcoded list DomainStatusStack used to own itself.
  const domainVisibility: Record<keyof typeof snapshots, boolean> = {
    deen: hasFaith,
    business: hasWork,
    fitness: hasFitness,
    school: hasSchoolDomain,
    co_op: hasWork,
  };
  const visibleSectorDomains = (["deen", "business", "fitness", "school", "co_op"] as const).filter(
    (key) => domainVisibility[key]
  );

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

  const ribbonLayout = computeDayRibbon({ dayBounds: dayShape.dayBounds, prayers: dayShape.prayers, activities: dayShape.activities, now });

  return (
    <PageContainer>
      <PageHeader title="Home" />

      <InProgressBanner items={inProgressItems} />

      <SessionEntryCard dueSummary={hasSelfMastery ? dueSummary : null} />

      <WeeklyGoalsHeader
        deen={deenGoal}
        business={businessGoal}
        onSaveDeen={saveWeeklyGoal.bind(null, "deen")}
        onSaveBusiness={saveWeeklyGoal.bind(null, "business")}
        showPlanningNudge={showPlanningNudge}
        showDeen={hasFaith}
        showBusiness={hasWork}
      />

      <DomainStatusStack snapshots={snapshots} title="Sector progress" visibleDomains={visibleSectorDomains} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Panel title="Now">
            <NextActions
              items={items}
              completedToday={completedToday}
              isFreshInstall={isFreshInstall}
              nowIso={now.toISOString()}
            />
          </Panel>
        </div>
        <div className="lg:col-span-4">
          <Panel title="Focus">
            <FocusModule
              deepWorkMinutes={extras.deepWork.minutes}
              deepWorkSessions={extras.deepWork.sessions}
              deepStudyMinutes={extras.deepStudy.minutes}
              deepStudySessions={extras.deepStudy.sessions}
              distractionsToday={distractionsToday}
              triggers={triggers}
            />
          </Panel>
        </div>
      </div>

      <Panel title="The day's shape">
        {ribbonLayout ? (
          <DayRibbon layout={ribbonLayout} todayStr={dateStr} timezone={timezone} />
        ) : (
          <EmptyState
            icon={Inbox}
            message="Set your location in Settings to see today's prayer-anchored timeline"
            action={{ label: "Go to Settings", href: "/settings" }}
          />
        )}
      </Panel>
    </PageContainer>
  );
}
