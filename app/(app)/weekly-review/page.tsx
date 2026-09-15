import { redirect } from "next/navigation";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, resolveLocalTime, formatShortDate, addDaysToDateString } from "@/lib/date-utils";
import { getHoursByKindForRange, getEndedRecallMinutesForRange } from "@/lib/evening-close/hours-today";
import { daysBetweenDateStrings } from "@/lib/habits/decay-score";
import { getDistractionPareto } from "@/lib/weekly-review/pareto";
import { getHabitWeeklySummaries } from "@/lib/weekly-review/habit-summary";
import { getMostRecentCompletedWeek, getThisWeekSoFar } from "@/lib/weekly-review/week-range";
import { WeeklyReviewView } from "@/components/weekly-review/weekly-review-view";

/**
 * The Weekly Review page (#46/#47/#48) — NOT at `/review` (that route is a
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
export default async function WeeklyReviewPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const { view } = await searchParams;
  const soFar = view === "so-far";

  const supabase = await createClient();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);

  const range = soFar ? getThisWeekSoFar(todayStr) : getMostRecentCompletedWeek(todayStr);
  const startIso = resolveLocalTime(range.startDate, "00:00", timezone).toISOString();
  const endIso = resolveLocalTime(range.endDateExclusive, "00:00", timezone).toISOString();
  const weekDayCount = daysBetweenDateStrings(range.startDate, range.endDateExclusive);

  const [hours, recallMinutes, pareto, habitSummaries] = await Promise.all([
    getHoursByKindForRange(supabase, user.id, startIso, endIso, new Date()),
    getEndedRecallMinutesForRange(supabase, user.id, startIso, endIso),
    getDistractionPareto(supabase, user.id),
    getHabitWeeklySummaries(supabase, user.id, range.startDate, range.endDateExclusive, todayStr, timezone),
  ]);

  const lastDayInclusive = addDaysToDateString(range.endDateExclusive, -1);

  return (
    <PageContainer>
      <PageHeader
        title="Weekly Review"
        description={
          soFar
            ? `${formatShortDate(range.startDate, todayStr)} – today`
            : `${formatShortDate(range.startDate, todayStr)} – ${formatShortDate(lastDayInclusive, todayStr)}`
        }
      />
      <WeeklyReviewView
        soFar={soFar}
        weekDayCount={weekDayCount}
        hours={hours}
        recallMinutes={recallMinutes}
        pareto={pareto}
        habitSummaries={habitSummaries}
      />
    </PageContainer>
  );
}
