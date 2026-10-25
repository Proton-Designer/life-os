import { redirect } from "next/navigation";
import { Panel } from "@/components/ui/panel";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, resolveLocalTime, formatShortDate, addDaysToDateString } from "@/lib/date-utils";
import { getHoursByKindForRange, getEndedRecallMinutesForRange, getHoursByDayForRange } from "@/lib/evening-close/hours-today";
import { getDayStartsForRange } from "@/lib/day-structure/day-start";
import { getEveningClosesForRange, bucketEfficiencyByClosedDay } from "@/lib/day-structure/closed-day";
import { daysBetweenDateStrings } from "@/lib/habits/decay-score";
import { getDistractionPareto } from "@/lib/weekly-review/pareto";
import { getHabitWeeklySummaries } from "@/lib/weekly-review/habit-summary";
import { getMostRecentCompletedWeek, getThisWeekSoFar } from "@/lib/weekly-review/week-range";
import { getCollegeOsWeeklyNarrative } from "@/lib/weekly-review/weekly-narrative";
import { hasAnyAiKey } from "@/lib/ai/resolve-key";
import { briefParagraphs, briefSourceLabel } from "@/lib/morning-brief/brief-source";
import { ConnectAgentHint } from "@/components/agent/connect-agent-hint";
import { WeeklyReviewView } from "@/components/weekly-review/weekly-review-view";
import { WakePlanNudge } from "@/components/weekly-review/wake-plan-nudge";
import { isOptInFeatureOnForRequest } from "@/lib/opt-in-guard";
import { getWindDownSettingsCore } from "@/lib/rhythm/wind-down-core";
import { wakeVsPlan, LATE_MINUTES } from "@/lib/rhythm/insights";
import { getForecastableAssessments } from "@/lib/school/get-forecastable-assessments";
import { computeCourseLoadForecast } from "@/lib/school/course-load-forecast";
import { CourseLoadForecastPanel } from "@/components/school/course-load-forecast-panel";
import { getPageLayout } from "@/app/(app)/page-layout-actions";
import { LayoutSlot, buildLayoutMap, allWidgetsHidden } from "@/components/page-layout/layout-slot";
import { WidgetManagerButton } from "@/components/page-layout/widget-manager-button";

// The weekly review shows only the upcoming three weeks (this one + the next two); /school keeps the default 6.
const COURSE_LOAD_WEEKS = 3;

/**
 * The Weekly Review body (moved out of /weekly-review by IA-P3a, now the Insights "Week" tab and /week step 1) (#46/#47/#48) — NOT at `/review` (that route is a
 * load-bearing redirect into `/close`'s account-stage inline distraction-
 * plan rewrite, actively covered by e2e/distractions.spec.ts:193 and
 * app/(app)/distractions/actions.ts's revalidatePath("/review") calls;
 * repurposing it would have broken the evening close's daily distraction
 * review, not built a new screen). Route and nav label ruled 2026-09-14.
 *
 * Default view is the most recently COMPLETED Sun-Sat week (ruled: "on
 * Sunday it shows the week that just ended — what 'Sunday review' means");
 * `?view=so-far` switches to the current, still-in-progress week. Both
 * come from lib/weekly-review/week-range.ts, never raw `Date` arithmetic.
 *
 * "Hours" CORRECTED 2026-09-15 (Opus Lead, found by browser-verifying
 * production): `getHoursByKindForRange` is `counts_toward_hours`-filtered
 * (deep_work/deep_study only), matching "Hours today" on /close and
 * /open/today and the Efficiency metric exactly — never 'learn'. Retrieval
 * review time is `getEndedRecallMinutesForRange`, a SEPARATE figure shown
 * outside Hours, deliberately excluding any still-open session (production
 * had abandoned reviews sitting open for 4+ hours, which must not display
 * as hours of study). See lib/evening-close/hours-today.ts's own comments
 * on both functions for the full reasoning.
 */
export async function WeeklyReviewBody({ soFar, viewBasePath, showViewSwitch = true }: { soFar: boolean; viewBasePath: string; showViewSwitch?: boolean }) {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);

  const range = soFar ? getThisWeekSoFar(todayStr) : getMostRecentCompletedWeek(todayStr);
  const startIso = resolveLocalTime(range.startDate, "00:00", timezone).toISOString();
  const endIso = resolveLocalTime(range.endDateExclusive, "00:00", timezone).toISOString();
  const weekDayCount = daysBetweenDateStrings(range.startDate, range.endDateExclusive);

  const [hours, recallMinutes, hoursByDay, dayStarts, eveningCloses, pareto, habitSummaries, narrative, forecastableAssessments, layout] = await Promise.all([
    getHoursByKindForRange(supabase, user.id, startIso, endIso, new Date()),
    getEndedRecallMinutesForRange(supabase, user.id, startIso, endIso),
    // P3-09: per-day hours, paired below with that day's own wake/close
    // marks for the closed-vs-open efficiency split -- the range total
    // above can't be un-summed back into individual days.
    getHoursByDayForRange(supabase, user.id, startIso, endIso, timezone, new Date()),
    getDayStartsForRange(supabase, user.id, range.startDate, range.endDateExclusive),
    getEveningClosesForRange(supabase, user.id, range.startDate, range.endDateExclusive),
    getDistractionPareto(supabase, user.id),
    getHabitWeeklySummaries(supabase, user.id, range.startDate, range.endDateExclusive, todayStr, timezone),
    // P2-03's AI weekly narrative -- keyed on `range.startDate`, so it only
    // ever matches a stored row for the COMPLETED week the cron generated
    // it for; the "so-far" (still in-progress) view naturally has no
    // matching row yet and renders nothing, same graceful-absence posture
    // as every other AI/cron-fed panel in this app (getMorningBriefForToday).
    getCollegeOsWeeklyNarrative(supabase, user.id, range.startDate),
    // P3-10: forward-looking from TODAY, same forecast P2-10 already built
    // for /school -- not tied to `range` (the completed/so-far week being
    // reviewed), since "what's coming up" is equally relevant context
    // either way. See lib/school/get-forecastable-assessments.ts's own
    // header for why this is a separate, leaner query than /school's own
    // classCards reuse.
    getForecastableAssessments(supabase, user.id),
    getPageLayout("weekly_review"),
  ]);
  // No narrative AND no key: say how to get one (an honest empty state), instead of a silently missing panel.
  const aiAvailable = narrative ? true : await hasAnyAiKey(supabase, user.id);
  const courseLoadForecast = computeCourseLoadForecast(forecastableAssessments, todayStr, COURSE_LOAD_WEEKS);

  // Sleep plan ON with a plan set: do the real mornings of this week run clearly later than the planned wake time?
  // Only a clearly-late median is worth a line (an on-time or early week says nothing); and only with enough mornings.
  let wakeNudge: React.ReactNode = null;
  if (await isOptInFeatureOnForRequest("sleep_plan")) {
    const windDown = await getWindDownSettingsCore(supabase, user.id);
    const wake = windDown.plan && windDown.wakeTime && windDown.sleepNeedMinutes !== null ? wakeVsPlan([...dayStarts.values()], windDown.wakeTime, timezone) : null;
    if (wake && windDown.wakeTime && windDown.sleepNeedMinutes !== null && wake.medianMinutesLate >= LATE_MINUTES && wake.suggestedWake !== windDown.wakeTime) {
      wakeNudge = (
        <WakePlanNudge
          plannedWake={windDown.wakeTime}
          suggestedWake={wake.suggestedWake}
          lateDays={wake.lateDays}
          n={wake.n}
          minutesLate={wake.medianMinutesLate}
          sleepNeedMinutes={windDown.sleepNeedMinutes}
          windDownMinutes={windDown.windDownMinutes}
        />
      );
    }
  }
  const layoutMap = buildLayoutMap(layout);

  // P3-09: one entry per calendar date in the reviewed range, pairing that
  // day's hours with its own wake/close marks (or nulls, if that day never
  // had one) -- bucketEfficiencyByClosedDay is the pure function that turns
  // this into the closed-vs-open split.
  const daysInRange: string[] = [];
  for (let d = range.startDate; d !== range.endDateExclusive; d = addDaysToDateString(d, 1)) {
    daysInRange.push(d);
  }
  const efficiency = bucketEfficiencyByClosedDay(
    daysInRange.map((localDate) => ({
      localDate,
      hoursMinutes: hoursByDay[localDate] ?? 0,
      wokeAtIso: dayStarts.get(localDate) ?? null,
      closedAtIso: eveningCloses.get(localDate) ?? null,
    }))
  );

  const lastDayInclusive = addDaysToDateString(range.endDateExclusive, -1);

  return (
    <div className="space-y-6" data-testid="weekly-review-body">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {soFar
            ? `${formatShortDate(range.startDate, todayStr)} – today`
            : `${formatShortDate(range.startDate, todayStr)} – ${formatShortDate(lastDayInclusive, todayStr)}`}
        </p>
        <WidgetManagerButton domainKey="weekly_review" />
      </div>
      {allWidgetsHidden(layout) ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          Every widget on this page is hidden. <WidgetManagerButton domainKey="weekly_review" variant="text" />
        </div>
      ) : null}
      <LayoutSlot layout={layoutMap} widgetKey="your_week">
      {narrative ? (
        <Panel title="Your week">
          <div className="space-y-2 text-sm text-muted-foreground">
            {briefParagraphs(narrative.text).map((paragraph, i) => (
              <p key={i} className="whitespace-pre-line">
                {paragraph}
              </p>
            ))}
          </div>
          {briefSourceLabel(narrative.provider, narrative.model) ? (
            <p data-testid="narrative-source" className="mt-2 text-xs text-muted-foreground/80">
              {briefSourceLabel(narrative.provider, narrative.model)}
            </p>
          ) : null}
        </Panel>
      ) : !aiAvailable ? (
        <Panel title="Your week">
          <ConnectAgentHint what="weekly narrative" />
        </Panel>
      ) : null}
      </LayoutSlot>
      <LayoutSlot layout={layoutMap} widgetKey="review">
      <WeeklyReviewView
        soFar={soFar}
        viewBasePath={viewBasePath}
        showViewSwitch={showViewSwitch}
        weekDayCount={weekDayCount}
        hours={hours}
        recallMinutes={recallMinutes}
        efficiency={efficiency}
        pareto={pareto}
        habitSummaries={habitSummaries}
      />
      </LayoutSlot>
      {wakeNudge}
      {/* P3-10: only when there's real signal in the 3 weeks shown here (this week + the next two) --
          same "only show real content" posture the narrative panel above
          already takes on this page, distinct from /school's own always-show
          (with an honest empty-state message) posture, which fits a
          School-focused page better than this broader review surface. */}
      <LayoutSlot layout={layoutMap} widgetKey="course_load">
      {courseLoadForecast.hasAnyUpcomingWork ? (
        <Panel title="Course load">
          <CourseLoadForecastPanel forecast={courseLoadForecast} todayStr={todayStr} />
        </Panel>
      ) : null}
      </LayoutSlot>
    </div>
  );
}
