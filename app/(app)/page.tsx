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
import { renderWidgets } from "@/lib/widgets/render";
import { McpWidgetsPanel } from "@/components/home/mcp-widgets-panel";
import { saveWeeklyGoal } from "@/app/(app)/actions";
import { getInProgressBooks } from "@/lib/self-mastery/get-in-progress-books";
import { getDueSummary, getSelfMasteryCandidateInput } from "@/app/(app)/personal/self-mastery-session-actions";
import { SessionEntryCard } from "@/components/self-mastery/session/session-entry-card";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { weeklyGoalDomains } from "@/lib/domains/weekly-goal-domains";
import { computeDomainVisibility } from "@/lib/home/compute-domain-visibility";
import { shouldShowSessionEntry } from "@/lib/home/session-entry-visibility";
import { resolveAreaWeights } from "@/lib/home/resolve-area-weights";
import { selectNextActionPerDomain } from "@/lib/home/next-actions";
import { buildCandidatesFromPriorityItems, buildSelfMasteryCandidate } from "@/lib/home/build-candidates";
import { rankCandidates } from "@/lib/home/arbiter";
import { getMorningBriefForToday } from "@/lib/ai/morning-brief";
import { getMySleepIntentForToday } from "@/app/(app)/close/sleep-intent-actions";
import { SleepIntentCard } from "@/components/home/sleep-intent-card";
import { getMyMorningRoutineChecklist } from "@/app/(app)/morning-routine/actions";
import { MorningRoutineCard } from "@/components/home/morning-routine-card";
import { getPageLayout } from "@/app/(app)/page-layout-actions";
import { LayoutSlot, buildLayoutMap, allWidgetsHidden } from "@/components/page-layout/layout-slot";
import { WidgetManagerButton } from "@/components/page-layout/widget-manager-button";

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

  const [
    items,
    completedToday,
    snapshots,
    extras,
    dayShape,
    weeklyGoalsResult,
    triggers,
    distractionsToday,
    inProgressItems,
    dueSummary,
    mcpWidgets,
    morningBrief,
    sleepIntent,
    morningRoutineItems,
    layout,
  ] = await Promise.all([
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
      // L11/R7 Tier 1 declarative widgets — degrades to [] the same way
      // getInProgressBooks() does until WIDGETS-MIGRATION-NEEDED.md lands.
      // now/timezone threaded through for the sparkline kind's local-day
      // bucketing (R12/AGENTS.md) — never a raw Date or a UTC slice.
      renderWidgets(supabase, userId, "home", now, timezone),
      // P2-02: null for every indistinguishable-by-design reason (not yet
      // generated today, no key, cap hit, provider failure) -- see
      // lib/ai/morning-brief.ts's own header. Home renders nothing in all
      // of them, matching gatewayChat's own "degrade to nothing broken"
      // posture rather than surfacing an error for an optional feature.
      getMorningBriefForToday(supabase, userId, now, timezone),
      // P2-05: decoupled from the evening close ritual entirely -- see
      // lib/night-plan/sleep-intent.ts's own header for why.
      getMySleepIntentForToday(),
      // P3-01: user-defined checklist, tz-correct check-off -- see
      // lib/morning-routine/actions-core.ts's own header for why.
      getMyMorningRoutineChecklist(),
      getPageLayout("home"),
    ]);
  const layoutMap = buildLayoutMap(layout);
  // WIDGET-02 exception, stated rather than silently applied: session_entry's
  // POSITION is not user-configurable -- selfMasteryRanksFirst (below) is a
  // real-time arbiter decision about whether this belongs above or below the
  // Now/Focus grid, and a saved layout `position` has no way to express "only
  // sometimes first." Hiding it entirely is still fully honored (a user who
  // never wants this card can turn it off), just not its rank among the rest.
  const sessionEntryHidden = layoutMap.get("session_entry")?.hidden ?? false;

  // Via the 115 bridge — reading "personal_growth:self_mastery" directly
  // makes Self-Mastery disappear the moment the group row is archived.
  const hasSelfMastery = hasArea(domainsState, "learning");

  // Phase 1 #24 fix (Opus Lead, 2026-09-15) — see shouldShowSessionEntry's
  // own header for the full mechanism and why this is NOT the same as
  // checking dueSummary?.starterDeckMissing.
  const showSessionEntry = shouldShowSessionEntry(hasSelfMastery, dueSummary);

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

  // A2 wiring (R18/R19): the real cross-domain arbiter, not a fixed
  // domain array or an unconditional layout position. weights comes from
  // resolveAreaWeights -- transitional per R27, real per what's landed on
  // production today. selfMasteryCandidateInput takes the ALREADY-fetched
  // dueSummary rather than re-querying (see that function's own comment).
  const weights = resolveAreaWeights(domainsState);
  // showSessionEntry, not hasSelfMastery alone — a School-only user's due
  // questions must be able to compete for the top "Now" slot the same way a
  // Self-Mastery user's due cards already do, not just be visible lower down.
  // Leaving this on hasSelfMastery while fixing visibility below would trade
  // one "built but unreachable" shape (invisible) for another (visible but
  // never ranked).
  const selfMasteryCandidateInput = showSessionEntry
    ? await getSelfMasteryCandidateInput(dueSummary)
    : { hasCandidate: false as const, dueAt: null, decay: null, cost: null };
  const selfMasteryCandidate = buildSelfMasteryCandidate(selfMasteryCandidateInput, weights);
  const rankedTopItems = selectNextActionPerDomain(items, weights, now);
  const topOtherCandidate = rankedTopItems.length > 0 ? buildCandidatesFromPriorityItems([rankedTopItems[0]], weights)[0] : null;
  // Self-Mastery only wins the top slot when it's a real candidate AND
  // either nothing else exists to compare against, or it genuinely
  // outranks the current top of the five-domain list -- never by default
  // position, which is the exact composition-level bug this closes (a
  // fixed deadline in 5 minutes must outrank a "ready to start" deck with
  // no due date at all).
  const selfMasteryRanksFirst =
    !!selfMasteryCandidate && (!topOtherCandidate || rankCandidates([selfMasteryCandidate, topOtherCandidate], now)[0]?.area === "self_mastery");

  return (
    <PageContainer>
      <PageHeader title="Home" actions={<WidgetManagerButton domainKey="home" />} />

      <InProgressBanner items={inProgressItems} />

      {allWidgetsHidden(layout) ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          Every widget on this page is hidden. <WidgetManagerButton domainKey="home" variant="text" />
        </div>
      ) : null}

      <LayoutSlot layout={layoutMap} widgetKey="morning_brief">
        {morningBrief ? (
          <Panel title="Your morning brief">
            <p className="whitespace-pre-line text-sm text-muted-foreground">{morningBrief}</p>
          </Panel>
        ) : null}
      </LayoutSlot>

      <LayoutSlot layout={layoutMap} widgetKey="morning_routine">
        <MorningRoutineCard initialItems={morningRoutineItems} />
      </LayoutSlot>

      <LayoutSlot layout={layoutMap} widgetKey="sleep_intent">
        <SleepIntentCard initialBedtime={sleepIntent} />
      </LayoutSlot>

      {/* Position responds to the real arbiter ranking (A2 wiring), not
          a fixed layout slot -- Self-Mastery only renders first when it
          genuinely outranks the current top of the five-domain list. See
          selfMasteryRanksFirst's own comment above and sessionEntryHidden's
          own comment on why this widget's ORDER is deliberately not
          user-configurable even though its VISIBILITY is (WIDGET-02). */}
      {!sessionEntryHidden && selfMasteryRanksFirst && <SessionEntryCard dueSummary={showSessionEntry ? dueSummary : null} />}

      <LayoutSlot layout={layoutMap} widgetKey="weekly_goals_header">
        <WeeklyGoalsHeader
          deen={deenGoal}
          business={businessGoal}
          onSaveDeen={saveWeeklyGoal.bind(null, "deen")}
          onSaveBusiness={saveWeeklyGoal.bind(null, "business")}
          showPlanningNudge={showPlanningNudge}
          showDeen={hasFaith}
          showBusiness={hasWork}
        />
      </LayoutSlot>

      <LayoutSlot layout={layoutMap} widgetKey="domain_status">
        <DomainStatusStack snapshots={snapshots} title="Sector progress" visibleDomains={visibleSectorDomains} />
      </LayoutSlot>

      {/* WIDGET-02: now/focus are independently reorderable/hideable
          widgets now (registry), so each is its own full-width LayoutSlot
          rather than a fixed side-by-side pair. */}
      <LayoutSlot layout={layoutMap} widgetKey="now">
        <Panel title="Now">
          <NextActions
            items={items}
            weights={weights}
            completedToday={completedToday}
            isFreshInstall={isFreshInstall}
            nowIso={now.toISOString()}
          />
        </Panel>
      </LayoutSlot>
      <LayoutSlot layout={layoutMap} widgetKey="focus">
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
      </LayoutSlot>

      {!sessionEntryHidden && !selfMasteryRanksFirst && <SessionEntryCard dueSummary={showSessionEntry ? dueSummary : null} />}

      <LayoutSlot layout={layoutMap} widgetKey="day_shape">
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
      </LayoutSlot>

      <LayoutSlot layout={layoutMap} widgetKey="mcp_widgets">
        <McpWidgetsPanel widgets={mcpWidgets} />
      </LayoutSlot>
    </PageContainer>
  );
}
