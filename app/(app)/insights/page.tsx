import Link from "next/link";
import { redirect } from "next/navigation";
import { Radar, Volume2, Target, Flame, CheckCircle2, BookOpen } from "lucide-react";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, addDaysToDateString, resolveLocalTime } from "@/lib/date-utils";
import { computeTrackingFloorDateStr } from "@/lib/deen/prayer-status";
import { createClient } from "@/lib/supabase/server";
import { getFocusMap } from "@/lib/insights/focus-map";
import { getInsightsKpis } from "@/lib/insights/insights-kpis";
import { getWeeklyCompletion } from "@/lib/home/get-weekly-completion";
import { bucketSignalNoiseByWeek, type SnAllocationRow, type WeekBoundary } from "@/lib/business/sn-trend";
import { getSignalNoiseForRange } from "@/lib/business/sn-ratio";
import { getUserDomainWeights } from "@/lib/business/domain-weights";
import { formatElapsedDuration } from "@/lib/business/format-elapsed";
import { buildWeeklyRecap, type WeekWindow } from "@/lib/weekly-planning/weekly-recap";
import { cn } from "@/lib/utils";
import { IconChip } from "@/components/ui/icon-chip";
import { KpiCard } from "@/components/ui/kpi-card";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { ACCENT_VAR, type AccentToken } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { RankedBars, type RankedBarsItem } from "@/components/charts/ranked-bars";
import { DonutChart } from "@/components/charts/donut-chart";
import { AreaChart } from "@/components/charts/area-chart";
import { BarChart } from "@/components/charts/bar-chart";

const SN_WEEK_COUNT = 6;
const RECAP_WEEK_COUNT = 6;

// Opus Lead review (2026-08-16, originally on the now-removed Weekly
// Planning page): BarChart's own empty state only fires when `bars` itself
// is empty — with 6 weeks of real zero *values* it still renders a live (if
// invisible) chart. In a small-multiples grid a bare axis reads as "nothing
// happened," which is defensible, but with two of four panels empty at once
// it's a lot of dead space. A compact line beats an invisible chart.
function SmallMultiple({
  label,
  bars,
  colorVar,
}: {
  label: string;
  bars: { label: string; value: number }[];
  colorVar: string;
}) {
  const hasData = bars.some((b) => b.value !== 0);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      {hasData ? (
        <BarChart bars={bars} colorVar={colorVar} highlightIndex={bars.length - 1} />
      ) : (
        <p className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
          No data this window
        </p>
      )}
    </div>
  );
}

// Allocation domains (2026-08-19: converted off the old tag_type vocabulary
// — kill_list/workout/school_co_op/noise/other_work don't exist in this
// model). Matches checkin_allocations.domain exactly, plus "wasted".
const SEGMENT_LABEL: Record<string, string> = {
  deen: "Deen",
  business: "Business",
  school: "School",
  fitness: "Fitness",
  co_op: "Work",
  wasted: "Wasted",
};

const SEGMENT_SERIES_VAR: Record<string, string> = {
  deen: "--series-deen",
  business: "--series-business",
  school: "--series-school",
  fitness: "--series-fitness",
  co_op: "--series-coop",
  wasted: "--series-other",
};

// wasted intentionally has no accent/icon — a plain color dot, never a
// domain-style IconChip, and never red (same neutral treatment as the
// donut's Wasted slice: information, not an accusation).
const SEGMENT_ACCENT: Partial<Record<string, AccentToken>> = {
  deen: "deen",
  business: "business",
  school: "school",
  fitness: "fitness",
  co_op: "coop",
};
const SEGMENT_ICON: Partial<Record<string, typeof DOMAIN_ICON.deen>> = {
  deen: DOMAIN_ICON.deen,
  business: DOMAIN_ICON.business,
  school: DOMAIN_ICON.school,
  fitness: DOMAIN_ICON.fitness,
  co_op: DOMAIN_ICON.co_op,
};

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; domain?: string }>;
}) {
  const { range: rangeParam, domain: highlightDomain } = await searchParams;
  const range = rangeParam === "day" ? "day" : "week";

  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(now, timezone);
  const weekStart = getWeekStartDate(todayStr);
  const previousWeekStart = addDaysToDateString(weekStart, -7);
  // Zero and no-data are different facts — a wiped or brand-new account
  // reads every metric as 0, and without this floor that 0 gets reported
  // as a real (if bad) result instead of "tracking hadn't started yet."
  // Same floor Deen's prayer-status derivation uses (lib/deen/prayer-status.ts).
  const trackingFloorDateStr = computeTrackingFloorDateStr(profile, timezone, now);
  const weekEntirelyBeforeTrackingFloor = (weekStartDate: string) =>
    addDaysToDateString(weekStartDate, 7) <= trackingFloorDateStr;
  const anchor =
    range === "week"
      ? resolveLocalTime(weekStart, "00:00", timezone)
      : resolveLocalTime(todayStr, "00:00", timezone);

  const snWeekStarts = Array.from({ length: SN_WEEK_COUNT }, (_, i) =>
    addDaysToDateString(weekStart, -7 * (SN_WEEK_COUNT - 1 - i))
  );
  // resolveLocalTime, not `${ws}T00:00:00Z` — see business/page.tsx and
  // weekly-planning/page.tsx's own fix comment (2026-08-19): UTC midnight
  // on a local date string misfiles Saturday-evening activity into the
  // wrong week in Chicago.
  const snWeeks: WeekBoundary[] = snWeekStarts.map((ws) => ({
    weekStartIso: resolveLocalTime(ws, "00:00", timezone).toISOString(),
    weekEndIso: resolveLocalTime(addDaysToDateString(ws, 7), "00:00", timezone).toISOString(),
    label: new Date(`${ws}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  }));

  // --- Week over week recap (2026-08-20: relocated here from the removed
  // Weekly Planning page) — strictly the last RECAP_WEEK_COUNT *completed*
  // weeks (ending at previousWeekStart), deliberately not the same window
  // as snWeeks above, which runs through the current still-accruing week.
  const recapWeekStarts = Array.from({ length: RECAP_WEEK_COUNT }, (_, i) =>
    addDaysToDateString(previousWeekStart, -7 * (RECAP_WEEK_COUNT - 1 - i))
  );
  const recapWeeks: WeekWindow[] = recapWeekStarts.map((ws) => ({
    weekStart: ws,
    label: new Date(`${ws}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  }));
  const recapSnWeeks: WeekBoundary[] = recapWeekStarts.map((ws, i) => ({
    weekStartIso: resolveLocalTime(ws, "00:00", timezone).toISOString(),
    weekEndIso: resolveLocalTime(addDaysToDateString(ws, 7), "00:00", timezone).toISOString(),
    label: recapWeeks[i].label,
  }));
  const earliestRecapWeekStart = recapWeekStarts[0];

  const supabase = await createClient();
  const [
    { segments },
    kpis,
    weeklyCompletion,
    { data: snCheckinRows },
    rangeSn,
    { data: recapPrayerRows },
    { data: recapKillListRows },
    { data: recapQuranRows },
    { data: recapCheckinRows },
    { data: previousDeenGoal },
    domainWeights,
  ] = await Promise.all([
    getFocusMap(userId, range, anchor),
    getInsightsKpis(userId, weekStart, previousWeekStart, timezone),
    getWeeklyCompletion(userId, now, profile),
    supabase
      .from("checkins")
      .select("window_start, checkin_allocations(domain, minutes, is_wasted)")
      .eq("user_id", userId)
      .eq("kind", "allocation")
      .gte("window_start", snWeeks[0].weekStartIso),
    getSignalNoiseForRange(userId, range, anchor),
    supabase
      .from("prayers")
      .select("date, status")
      .eq("user_id", userId)
      .gte("date", earliestRecapWeekStart)
      .lt("date", weekStart),
    supabase
      .from("kill_list_items")
      .select("date, completed")
      .eq("user_id", userId)
      .gte("date", earliestRecapWeekStart)
      .lt("date", weekStart),
    supabase
      .from("quran_sessions")
      .select("date, pages_read")
      .eq("user_id", userId)
      .gte("date", earliestRecapWeekStart)
      .lt("date", weekStart),
    supabase
      .from("checkins")
      .select("window_start, checkin_allocations(domain, minutes, is_wasted)")
      .eq("user_id", userId)
      .eq("kind", "allocation")
      .gte("window_start", recapSnWeeks[0].weekStartIso),
    supabase
      .from("weekly_goals")
      .select("quran_page_target")
      .eq("user_id", userId)
      .eq("domain", "deen")
      .eq("week_start_date", previousWeekStart)
      .maybeSingle(),
    getUserDomainWeights(userId),
  ]);

  const hasFocusData = segments.length > 0;
  const domainSegments = segments.filter((s) => s.domain !== "wasted");
  const wastedSegment = segments.find((s) => s.domain === "wasted") ?? null;

  // --- Signal:Noise, allocation-minutes based (2026-08-19 Phase 4 + donut
  // unification): the donut (rangeSn, this day/week) and the 6-week bar
  // trend below now share one source — lib/business/sn-ratio.ts — instead
  // of the donut reading getFocusMap's separate tag_type-count ratio.
  // getFocusMap is segments-only now, still point-sample-based, and only
  // feeds the Focus Map / Per-domain panels further down. ---
  const hasSnData = rangeSn.signalMinutes + rangeSn.noiseMinutes > 0;
  const snAllocationRows: SnAllocationRow[] = (snCheckinRows ?? []).flatMap((c) =>
    (c.checkin_allocations ?? []).map((a) => ({ windowStartIso: c.window_start ?? "", domain: a.domain, minutes: a.minutes, isWasted: a.is_wasted }))
  );
  const snByWeek = bucketSignalNoiseByWeek(snAllocationRows, snWeeks, domainWeights);
  const thisWeekSn = snByWeek[snByWeek.length - 1];
  const snBars = snByWeek.map((w) => ({
    label: w.label,
    value: w.noiseMinutes === 0 ? w.signalMinutes / 15 : Math.round((w.signalMinutes / w.noiseMinutes) * 10) / 10,
  }));
  const hasAnySnWeekData = snByWeek.some((w) => w.signalMinutes + w.noiseMinutes > 0);

  // --- Week over week recap (relocated from Weekly Planning) ---
  const recap = buildWeeklyRecap(recapPrayerRows ?? [], recapKillListRows ?? [], recapQuranRows ?? [], recapWeeks);
  const recapSnAllocationRows: SnAllocationRow[] = (recapCheckinRows ?? []).flatMap((c) =>
    (c.checkin_allocations ?? []).map((a) => ({ windowStartIso: c.window_start ?? "", domain: a.domain, minutes: a.minutes, isWasted: a.is_wasted }))
  );
  const recapSnByWeek = bucketSignalNoiseByWeek(recapSnAllocationRows, recapSnWeeks, domainWeights);
  const recapSnBars = recapSnByWeek.map((w) => ({
    label: w.label,
    value: w.noiseMinutes === 0 ? w.signalMinutes / 15 : Math.round((w.signalMinutes / w.noiseMinutes) * 10) / 10,
  }));
  const lastWeekRecap = recap[recap.length - 1];
  const priorWeekRecap = recap[recap.length - 2];
  const lastWeekRecapSn = recapSnByWeek[recapSnByWeek.length - 1];
  // "0/35 last week" and a "+0" delta both read as a real (if bad) result
  // — a week that predates tracking_started_on has no record to report at
  // all, not a zero one. priorWeekRecap always exists as an object (recap
  // is built by mapping over a fixed week list), so testing for its
  // presence alone never catches this — the actual question is whether
  // that week's window ever had a chance to contain real data.
  const lastRecapWeekBeforeFloor = weekEntirelyBeforeTrackingFloor(recapWeeks[recapWeeks.length - 1].weekStart);
  const priorRecapWeekBeforeFloor = weekEntirelyBeforeTrackingFloor(recapWeeks[recapWeeks.length - 2].weekStart);

  const weeklyAvgPct = Math.round(
    weeklyCompletion.weeklyCompletionPct.reduce((a, b) => a + b, 0) / weeklyCompletion.weeklyCompletionPct.length
  );
  // All-zero isn't a tie to break — it's the absence of a result. There is
  // no "best day" among zeros, so don't manufacture a ranking out of them.
  const hasWeeklyCompletionData = weeklyCompletion.weeklyCompletionPct.some((v) => v > 0);
  const bestDayIndex = weeklyCompletion.weeklyCompletionPct.reduce(
    (best, v, i) => (v > weeklyCompletion.weeklyCompletionPct[best] ? i : best),
    0
  );

  const rankedItems: RankedBarsItem[] = segments.map((s) => ({
    label: SEGMENT_LABEL[s.domain] ?? s.domain,
    value: s.minutes,
    displayValue: formatElapsedDuration(s.minutes * 60_000),
    colorVar: SEGMENT_SERIES_VAR[s.domain] ?? "--series-other",
  }));

  const mostFocusedIcon = kpis.mostFocusedDomain ? (SEGMENT_ICON[kpis.mostFocusedDomain] ?? Target) : Target;
  const mostFocusedAccent: AccentToken = kpis.mostFocusedDomain
    ? (SEGMENT_ACCENT[kpis.mostFocusedDomain] ?? "info")
    : "neutral";

  return (
    <PageContainer>
      <PageHeader
        title="Insights"
        actions={
          <div className="flex gap-2 text-sm">
            <Link
              href="/insights?range=day"
              className={cn("rounded-full px-3 py-1", range === "day" ? "bg-accent" : "text-muted-foreground")}
            >
              Day
            </Link>
            <Link
              href="/insights?range=week"
              className={cn("rounded-full px-3 py-1", range === "week" ? "bg-accent" : "text-muted-foreground")}
            >
              Week
            </Link>
          </div>
        }
      />

      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-3">
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={Radar}
            accent="info"
            label="Check-in coverage"
            value={`${Math.round(kpis.coveragePct)}%`}
            caption={
              kpis.totalSlots === 0
                ? "No check-in slots yet this week"
                : `${kpis.answeredCount} of ${kpis.totalSlots} answered this week`
            }
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={mostFocusedIcon}
            accent={mostFocusedAccent}
            label="Most-focused domain"
            value={kpis.mostFocusedDomain ? (SEGMENT_LABEL[kpis.mostFocusedDomain] ?? kpis.mostFocusedDomain) : "—"}
            caption={kpis.mostFocusedDomain ? "by answered check-ins this week" : "No focus data yet this week"}
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={Volume2}
            accent={kpis.noiseShareDeltaPct > 0 ? "warning" : kpis.noiseShareDeltaPct < 0 ? "business" : "neutral"}
            label="Noise share"
            value={`${Math.round(kpis.noiseSharePct)}%`}
            caption={
              !kpis.hasNoiseComparisonData
                ? "No data this week"
                : kpis.noiseShareDeltaPct === 0
                  ? "Same as last week"
                  : `${kpis.noiseShareDeltaPct > 0 ? "+" : ""}${Math.round(kpis.noiseShareDeltaPct)}pp vs last week`
            }
          />
        </div>
      </div>

      {/* Moved from Home (2026-08-17 day-shape spec) — a completion-percent
          trend is a pattern-over-time chart, which belongs here per Ayman's
          own "metrics belong in Insights, not Home" rule. Independent of
          the day/week range toggle above: always the trailing 7 days,
          matching what this chart showed on Home. */}
      <Panel
        title="This week"
        heroValue={`${weeklyAvgPct}%`}
        caption={
          hasWeeklyCompletionData
            ? `${weeklyCompletion.weeklyCompletionLabels[bestDayIndex]} was your best day this week`
            : "No data this week"
        }
      >
        <AreaChart
          categories={weeklyCompletion.weeklyCompletionLabels}
          series={[{ label: "Completion", colorVar: "--series-business", values: weeklyCompletion.weeklyCompletionPct }]}
          unit="%"
        />
      </Panel>

      {hasAnySnWeekData ? (
        <Panel
          title="Signal:Noise by week"
          heroValue={thisWeekSn.display}
          // Split displayed explicitly, never just a combined "noise"
          // total — a heavy school week and a lost afternoon both land on
          // the noise side and are nothing alike (spec, 2026-08-19).
          caption={`This week: ${thisWeekSn.otherCommitmentsMinutes}m other commitments · ${thisWeekSn.wastedMinutes}m wasted`}
        >
          <BarChart bars={snBars} colorVar="--series-business" highlightIndex={snBars.length - 1} />
        </Panel>
      ) : (
        <Panel title="Signal:Noise by week">
          <EmptyState
            icon={Volume2}
            message="No allocation check-ins answered yet in the last 6 weeks"
            action={{ label: "Start a Lock-In session", href: "/business" }}
          />
        </Panel>
      )}

      {/* Week over week (2026-08-20: relocated from the removed Weekly
          Planning page, whole and unchanged — its goal-editing half moved
          to Home's "This week's focus" panel instead). Strictly the last 6
          COMPLETED weeks (ends at last week), unlike the current-week-
          inclusive Signal:Noise panel above. */}
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-4">
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={Flame}
            accent="deen"
            label="Prayers on time"
            value={lastRecapWeekBeforeFloor ? "—" : `${lastWeekRecap.prayersOnTime}/35`}
            caption={lastRecapWeekBeforeFloor ? "before you started tracking" : "last week"}
            sparkline={recap.map((r) => r.prayersOnTime)}
            delta={
              !lastRecapWeekBeforeFloor && !priorRecapWeekBeforeFloor
                ? {
                    direction: lastWeekRecap.prayersOnTime >= priorWeekRecap.prayersOnTime ? "up" : "down",
                    text: `${lastWeekRecap.prayersOnTime - priorWeekRecap.prayersOnTime >= 0 ? "+" : ""}${lastWeekRecap.prayersOnTime - priorWeekRecap.prayersOnTime}`,
                  }
                : undefined
            }
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={CheckCircle2}
            accent="business"
            label="Days cleared"
            value={lastRecapWeekBeforeFloor ? "—" : `${lastWeekRecap.killListDaysCleared}/7`}
            caption={lastRecapWeekBeforeFloor ? "before you started tracking" : "kill list, last week"}
            sparkline={recap.map((r) => r.killListDaysCleared)}
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={BookOpen}
            accent="deen"
            label="Qur'an pages"
            value={lastRecapWeekBeforeFloor ? "—" : `${lastWeekRecap.quranPages}`}
            caption={
              lastRecapWeekBeforeFloor
                ? "before you started tracking"
                : previousDeenGoal?.quran_page_target
                  ? `target: ${previousDeenGoal.quran_page_target}`
                  : "last week"
            }
            sparkline={recap.map((r) => r.quranPages)}
          />
        </div>
        <div className="w-[78vw] shrink-0 snap-start md:w-auto">
          <KpiCard
            icon={Target}
            accent="business"
            label="Signal:Noise"
            value={lastWeekRecapSn.signalMinutes + lastWeekRecapSn.noiseMinutes === 0 ? "—" : lastWeekRecapSn.display}
            caption={
              lastRecapWeekBeforeFloor
                ? "before you started tracking"
                : lastWeekRecapSn.signalMinutes + lastWeekRecapSn.noiseMinutes === 0
                  ? "No check-ins last week"
                  : "last week"
            }
            sparkline={recapSnBars.map((b) => b.value)}
          />
        </div>
      </div>

      <Panel title="Week over week">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <SmallMultiple
            label="Prayers on time"
            bars={recap.map((r) => ({ label: r.label, value: r.prayersOnTime }))}
            colorVar="--series-deen"
          />
          <SmallMultiple
            label="Days cleared"
            bars={recap.map((r) => ({ label: r.label, value: r.killListDaysCleared }))}
            colorVar="--series-business"
          />
          <SmallMultiple
            label="Qur'an pages"
            bars={recap.map((r) => ({ label: r.label, value: r.quranPages }))}
            colorVar="--series-deen"
          />
          <SmallMultiple label="Signal:Noise" bars={recapSnBars} colorVar="--series-business" />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Panel title="Focus Map">
            {hasFocusData ? (
              <RankedBars items={rankedItems} />
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">No check-ins answered in this range yet</p>
            )}
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel title="Signal:Noise">
            {hasSnData ? (
              // Noise split into two slices, never merged — a heavy school
              // week and a lost afternoon are nothing alike (spec,
              // 2026-08-19). Wasted stays a neutral/muted color, never red:
              // it's information, not an accusation.
              <DonutChart
                slices={[
                  { label: "Signal", value: rangeSn.signalMinutes, colorVar: "--series-business" },
                  { label: "Other commitments", value: rangeSn.otherCommitmentsMinutes, colorVar: "--series-noise" },
                  { label: "Wasted", value: rangeSn.wastedMinutes, colorVar: "--series-other" },
                ]}
                centerLabel="Ratio"
                centerValue={rangeSn.display}
              />
            ) : (
              <EmptyState
                icon={Volume2}
                message="No allocation check-ins answered in this range yet"
                action={{ label: "Start a Lock-In session", href: "/business" }}
              />
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Per-domain">
        {domainSegments.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">No per-domain data in this range yet</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {domainSegments.map((s) => {
              const accent = SEGMENT_ACCENT[s.domain];
              const Icon = SEGMENT_ICON[s.domain];
              const isHighlighted = highlightDomain === s.domain;
              return (
                <li
                  key={s.domain}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm",
                    !isHighlighted && "border-border/40"
                  )}
                  style={
                    isHighlighted && accent
                      ? { borderColor: `color-mix(in oklch, var(${ACCENT_VAR[accent]}) 60%, transparent)` }
                      : undefined
                  }
                >
                  {Icon && accent && <IconChip icon={Icon} accent={accent} size="sm" />}
                  <span className="flex-1">{SEGMENT_LABEL[s.domain] ?? s.domain}</span>
                  <span className="font-mono font-medium tabular-nums">
                    {formatElapsedDuration(s.minutes * 60_000)} · {Math.round(s.pct)}%
                  </span>
                </li>
              );
            })}
            {wastedSegment && (
              <li className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3 text-sm text-muted-foreground">
                <span className="size-8 shrink-0" aria-hidden />
                <span className="flex-1">Wasted</span>
                <span className="font-mono font-medium tabular-nums">
                  {formatElapsedDuration(wastedSegment.minutes * 60_000)} · {Math.round(wastedSegment.pct)}%
                </span>
              </li>
            )}
          </ul>
        )}
      </Panel>
    </PageContainer>
  );
}
