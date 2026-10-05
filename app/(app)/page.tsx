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
import { withoutDeenDomain } from "@/lib/distractions/deen-filter";
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
import { hasOptInFeature } from "@/lib/opt-in-features";
import { getRhythmData } from "@/lib/home/rhythm-data";
import { Stream } from "@/components/home/stream";
import { loadFocusTargetMinutes } from "@/lib/focus/target-core";
import { HOME_DAY_VIEW } from "@/lib/home/day-view";
import { PanelSkeleton, DomainStatusStripSkeleton, WeeklyGoalsHeaderSkeleton } from "@/components/shell/route-skeleton";
import { getActiveHabitsWithStatus } from "@/lib/habits/queries";
import { shouldShowWeeklyResetCard } from "@/lib/home/weekly-reset-visibility";
import { HabitCheckoffs } from "@/components/home/habit-checkoffs";
import { WeeklyResetCard } from "@/components/home/weekly-reset-card";
import { GoalsSheetButton } from "@/components/goals/goals-sheet-button";
import { RhythmSection } from "@/components/home/rhythm/rhythm-section";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { weeklyGoalDomains } from "@/lib/domains/weekly-goal-domains";
import { buildSectorRows, showBusinessWeeklyGoal, wantedSnapshots } from "@/lib/home/sector-rows";
import { shouldShowSessionEntry } from "@/lib/home/session-entry-visibility";
import { resolveAreaWeights } from "@/lib/home/resolve-area-weights";
import { selectNextActionPerDomain } from "@/lib/home/next-actions";
import { buildCandidatesFromPriorityItems, buildSelfMasteryCandidate } from "@/lib/home/build-candidates";
import { rankCandidates } from "@/lib/home/arbiter";
import { getMorningBriefForToday } from "@/lib/ai/morning-brief";
import { loadHomeWindDown } from "@/lib/home/wind-down-home";
import { WindDownCard } from "@/components/home/wind-down-card";
import { getMyMorningRoutineChecklist } from "@/app/(app)/morning-routine/actions";
import { LaunchSequenceCard } from "@/components/home/launch-sequence-card";
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
  // Deen Mode (profiles.deen_mode): one boolean read once, handed to every Home
  // gate below. OFF = nothing religious renders and no deen query runs.
  const deenMode = isDeenModeOn(profile);
  const morningRoutineOn = hasOptInFeature(profile?.enabled_features, "morning_routine");
  const sleepPlanOn = hasOptInFeature(profile?.enabled_features, "sleep_plan");
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
  const sectorRows = buildSectorRows(domainsState, deenMode);
  const wantedSectors = wantedSnapshots(sectorRows);

  // IA-P4b: the wind-down plan (Sleep plan ON only) sets when the rhythm card flips and shows "Lights out by".
  const windDownPromise = loadHomeWindDown(supabase, userId, sleepPlanOn);

  // NAV-01b: the slow, independent modules START now (parallel with everything below) but are not
  // awaited here -- the page shell and the fast modules paint first and each streams in through
  // <Stream> (components/home/stream.tsx). Data-free-skip rules are unchanged (wantedSectors,
  // opt-in gates, Deen): they decide WHAT is started, streaming only changes WHEN it renders.
  // SECTOR-01: only the areas this account has set up are read (and shown).
  const snapshotsPromise = getDomainSnapshots(userId, now, undefined, wantedSectors);
  // L11/R7 Tier 1 declarative widgets -- degrades to [] until the widgets migration lands; now/timezone
  // threaded through for the sparkline kind's local-day bucketing (R12/AGENTS.md).
  const mcpWidgetsPromise = renderWidgets(supabase, userId, "home", now, timezone);
  // IA-P2: only the active phase's reads run (lib/home/rhythm-data.ts).
  const rhythmPromise = windDownPromise.then((w) => getRhythmData(supabase, userId, now, timezone, { windDownStart: w?.windDownStart, bedtime: w?.bedtime }));
  // IA-P3b: today's habit check-offs (the habits board's own reader).
  const activeHabitsPromise = getActiveHabitsWithStatus(supabase, userId, dateStr, timezone);
  // A failure must reach the error boundary through <Stream>, not as an unhandled rejection before it is awaited.
  // The Launch card needs the rhythm phase AND the habits; built only for an account with the opt-in on,
  // from the promises already running (no extra reads), and guarded like the others.
  // HOME-01a: the adjustable daily focus target (weekend override), in minutes; shown on the Day bar / Hours tile.
  const focusTargetPromise = loadFocusTargetMinutes(supabase, userId, dateStr);
  const launchPromise = morningRoutineOn ? Promise.all([rhythmPromise, activeHabitsPromise]) : null;
  for (const p of [snapshotsPromise, mcpWidgetsPromise, rhythmPromise, activeHabitsPromise, focusTargetPromise, ...(launchPromise ? [launchPromise] : [])]) p.catch(() => undefined);

  const hasSelfMastery = hasArea(domainsState, "learning");
  const dueSessionPromise = getDueSummary().then(async (dueSummary) => {
    // showSessionEntry, not hasSelfMastery alone -- a School-only user's due questions must be able
    // to compete for the top "Now" slot too (see shouldShowSessionEntry's header).
    const showSessionEntry = shouldShowSessionEntry(hasSelfMastery, dueSummary);
    const candidateInput = showSessionEntry
      ? await getSelfMasteryCandidateInput(dueSummary)
      : { hasCandidate: false as const, dueAt: null, decay: null, cost: null };
    return { dueSummary, showSessionEntry, candidateInput };
  });

  // Weekly planning nudge: unlocks Saturday evening, no hard lockout -- just a nudge until it's done,
  // per spec. "This week" is the upcoming week (starts tomorrow, Sunday). Started with the rest
  // (it only needs the date), not awaited on its own after them.
  const isSaturdayEvening =
    localWeekday(now, timezone) === "Saturday" &&
    (now.getUTCHours() * 60 + now.getUTCMinutes() + getTimezoneOffsetMinutes(now, timezone)) % 1440 >= 18 * 60;
  const upcomingGoalsPromise: Promise<boolean> = isSaturdayEvening
    ? Promise.resolve(
        supabase
          .from("weekly_goals")
          .select("id")
          .eq("user_id", userId)
          .eq("week_start_date", addDaysToDateString(getWeekStartDate(dateStr), 7))
      ).then(({ data }) => (data?.length ?? 0) === 0)
    : Promise.resolve(false);

  const [
    items,
    completedToday,
    extras,
    dayShape,
    weeklyGoalsResult,
    triggers,
    distractionsToday,
    inProgressItems,
    dueSession,
    showPlanningNudge,
    morningBrief,
    windDown,
    morningRoutineItems,
    layout,
  ] = await Promise.all([
      getPriorityItems(userId, now),
      getCompletedItemsToday(userId, now),
      getHomeExtras(userId, now, profile),
      getDayShape(userId, now),
      supabase
        .from("weekly_goals")
        .select("domain, headline, milestones, quran_page_target")
        .eq("user_id", userId)
        .eq("week_start_date", weekStart)
        .in("domain", weeklyGoalDomains(domainsState, deenMode)),
      getAllTriggers(supabase, userId, dateStr).then((all) => withoutDeenDomain(all, deenMode)),
      getTodayDistractionCount(supabase, userId, dateStr, isDeenModeOn(profile)),
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
      // The due summary and the Self-Mastery candidate input (which needs it) chain INSIDE this Promise.all
      // (NAV-01b follow-up): they used to be a second sequential await after everything else resolved.
      dueSessionPromise,
      upcomingGoalsPromise,
      // P2-02: null for every indistinguishable-by-design reason (not yet
      // generated today, no key, cap hit, provider failure) -- see
      // lib/ai/morning-brief.ts's own header. Home renders nothing in all
      // of them, matching gatewayChat's own "degrade to nothing broken"
      // posture rather than surfacing an error for an optional feature.
      getMorningBriefForToday(supabase, userId, now, timezone),
      // P2-05: decoupled from the evening close ritual entirely -- see
      // lib/night-plan/sleep-intent.ts's own header for why.
      // Opt-in features (RS-01): OFF = the query is skipped, not fetched-then-hidden.
      windDownPromise,
      // P3-01: user-defined checklist, tz-correct check-off -- see
      // lib/morning-routine/actions-core.ts's own header for why.
      morningRoutineOn ? getMyMorningRoutineChecklist() : Promise.resolve([]),
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

  // Phase 1 #24 fix (Opus Lead, 2026-09-15) — see shouldShowSessionEntry's own header for the full
  // mechanism. The due summary, the show decision and the ranking candidate input all resolved inside
  // the Promise.all above.
  const { dueSummary, showSessionEntry, candidateInput: selfMasteryCandidateInput } = dueSession;

  // Body-level gating (Opus Lead finding, stranger-journey e2e): the nav
  // gates correctly, but Home's own content did not — Sector progress and
  // This Week's Focus previously rendered all 5 legacy domains
  // unconditionally, advertising domains a user explicitly declined during
  // onboarding. SECTOR-01: lib/home/sector-rows.ts is now the one source for
  // both the rows and the queries that feed them (a legacy account keeps all
  // five rows, unit-tested directly there); the Weekly goals header reads the
  // same answer so the two can never disagree.
  const hasFaith = wantedSectors.deen;
  const hasBusinessGoal = showBusinessWeeklyGoal(domainsState, deenMode);

  const weeklyGoalsRows = weeklyGoalsResult.data ?? [];
  // IA-P3b: the Sunday card (Sun 00:00-Mon 12:00 local) disappears once this week's goal has a headline.
  const showWeeklyReset = shouldShowWeeklyResetCard(now, timezone, weeklyGoalsRows.map((g) => g.headline));
  const deenGoalRow = weeklyGoalsRows.find((g) => g.domain === "deen") ?? null;
  const businessGoalRow = weeklyGoalsRows.find((g) => g.domain === "business") ?? null;
  const deenGoalFor = (snapshots: Awaited<typeof snapshotsPromise> | null) =>
    deenGoalRow
      ? {
          headline: deenGoalRow.headline,
          milestones: (deenGoalRow.milestones as string[] | null) ?? [],
          quranPages: snapshots?.deen.quranWeekPages,
          quranTarget: snapshots?.deen.quranWeeklyTarget,
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

  const ribbonLayout = computeDayRibbon({ dayBounds: dayShape.dayBounds, prayers: dayShape.prayers, activities: dayShape.activities, now });

  // A2 wiring (R18/R19): the real cross-domain arbiter, not a fixed
  // domain array or an unconditional layout position. weights comes from
  // resolveAreaWeights -- transitional per R27, real per what's landed on
  // production today. selfMasteryCandidateInput takes the ALREADY-fetched
  // dueSummary rather than re-querying (see that function's own comment).
  const weights = resolveAreaWeights(domainsState, deenMode);
  // showSessionEntry, not hasSelfMastery alone — a School-only user's due
  // questions must be able to compete for the top "Now" slot the same way a
  // Self-Mastery user's due cards already do, not just be visible lower down.
  // Leaving this on hasSelfMastery while fixing visibility below would trade
  // one "built but unreachable" shape (invisible) for another (visible but
  // never ranked).
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

  const renderGoalsHeader = (deenGoal: ReturnType<typeof deenGoalFor>) => (
    <WeeklyGoalsHeader
      deen={deenGoal}
      business={businessGoal}
      onSaveDeen={saveWeeklyGoal.bind(null, "deen")}
      onSaveBusiness={saveWeeklyGoal.bind(null, "business")}
      showPlanningNudge={showPlanningNudge}
      showDeen={hasFaith}
      showBusiness={hasBusinessGoal}
      extraActions={<GoalsSheetButton />}
    />
  );

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

      <LayoutSlot layout={layoutMap} widgetKey="rhythm">
        <Stream promise={Promise.all([rhythmPromise, focusTargetPromise])} label="Your day" fallback={<PanelSkeleton titleWidth="w-28" bodyHeight="h-28" />}>
          {([rhythm, targetMinutes]) => <RhythmSection data={rhythm} ribbon={ribbonLayout} timezone={timezone} targetMinutes={targetMinutes} dayView={HOME_DAY_VIEW} />}
        </Stream>
      </LayoutSlot>

      {showWeeklyReset && (
        <LayoutSlot layout={layoutMap} widgetKey="weekly_reset">
          <WeeklyResetCard />
        </LayoutSlot>
      )}

      {morningRoutineOn && (
        <LayoutSlot layout={layoutMap} widgetKey="morning_routine">
          {/* fallback null: the card only shows in the morning/today phases, and the phase is unknown until
              the rhythm resolves -- a skeleton here would flash and collapse in wind-down/done. */}
          <Stream promise={launchPromise!} label="Launch sequence" fallback={null}>
            {([rhythm, activeHabits]) =>
              rhythm.state === "morning" || rhythm.state === "today" ? (
                <LaunchSequenceCard
                  items={morningRoutineItems}
                  today={dateStr}
                  habits={activeHabits.map((h) => ({ id: h.id, identityStatement: h.identityStatement }))}
                />
              ) : null
            }
          </Stream>
        </LayoutSlot>
      )}

      {sleepPlanOn && (
        <LayoutSlot layout={layoutMap} widgetKey="sleep_intent">
          {windDown && <WindDownCard settings={windDown.settings} />}
        </LayoutSlot>
      )}

      {/* Position responds to the real arbiter ranking (A2 wiring), not
          a fixed layout slot -- Self-Mastery only renders first when it
          genuinely outranks the current top of the five-domain list. See
          selfMasteryRanksFirst's own comment above and sessionEntryHidden's
          own comment on why this widget's ORDER is deliberately not
          user-configurable even though its VISIBILITY is (WIDGET-02). */}
      {!sessionEntryHidden && selfMasteryRanksFirst && <SessionEntryCard dueSummary={showSessionEntry ? dueSummary : null} />}

      <LayoutSlot layout={layoutMap} widgetKey="weekly_goals_header">
        {/* Only an account with a saved Deen goal needs the Quran numbers from the (streamed) snapshots; everyone else renders at once. */}
        {hasFaith && deenGoalRow ? (
          <Stream promise={snapshotsPromise} label="Weekly goals" fallback={<WeeklyGoalsHeaderSkeleton />}>
            {(snapshots) => renderGoalsHeader(deenGoalFor(snapshots))}
          </Stream>
        ) : (
          renderGoalsHeader(deenGoalFor(null))
        )}
      </LayoutSlot>

      <LayoutSlot layout={layoutMap} widgetKey="domain_status">
        <Stream promise={snapshotsPromise} label="Sector progress" fallback={<DomainStatusStripSkeleton />}>
          {(snapshots) => <DomainStatusStack snapshots={snapshots} title="Sector progress" rows={sectorRows} />}
        </Stream>
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
      <LayoutSlot layout={layoutMap} widgetKey="habit_checkoffs">
        <Stream promise={activeHabitsPromise} label="Habits today" fallback={null}>
          {(activeHabits) => <HabitCheckoffs habits={activeHabits} today={dateStr} />}
        </Stream>
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

      {/* HOME-02: in "bar" view the day's shape lives inside the Day bar (rhythm card), so this slot renders
          nothing; its widget key stays in the registry so saved layouts keep working. "classic" = as before. */}
      <LayoutSlot layout={layoutMap} widgetKey="day_shape">
        {HOME_DAY_VIEW === "classic" ? (
          <Panel title="The day's shape">
            {ribbonLayout ? (
              <DayRibbon layout={ribbonLayout} todayStr={dateStr} timezone={timezone} />
            ) : (
              <EmptyState
                icon={Inbox}
                message={
                  deenMode
                    ? "Set your location in Settings to see today's prayer-anchored timeline"
                    : "Set your wake and sleep times in Settings to see today's timeline"
                }
                action={{ label: "Go to Settings", href: "/settings" }}
              />
            )}
          </Panel>
        ) : null}
      </LayoutSlot>

      <LayoutSlot layout={layoutMap} widgetKey="mcp_widgets">
        <Stream promise={mcpWidgetsPromise} label="Agent widgets" fallback={null}>
          {(mcpWidgets) => <McpWidgetsPanel widgets={mcpWidgets} />}
        </Stream>
      </LayoutSlot>
    </PageContainer>
  );
}
