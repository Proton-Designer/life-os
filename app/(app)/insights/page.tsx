import Link from "next/link";
import { redirect } from "next/navigation";
import { Radar, Volume2, Target } from "lucide-react";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, addDaysToDateString, resolveLocalTime } from "@/lib/date-utils";
import { createClient } from "@/lib/supabase/server";
import { getFocusMap } from "@/lib/insights/focus-map";
import { getInsightsKpis } from "@/lib/insights/insights-kpis";
import { computeRatioDisplay } from "@/lib/insights/ratio-display";
import { getWeeklyCompletion } from "@/lib/home/get-weekly-completion";
import { bucketSignalNoiseByWeek, type SnAllocationRow, type WeekBoundary } from "@/lib/business/sn-trend";
import { getSignalNoiseForRange } from "@/lib/business/sn-ratio";
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

const SEGMENT_LABEL: Record<string, string> = {
  deen: "Deen",
  business: "Business",
  fitness: "Fitness",
  school_co_op: "School/Co-op",
  noise: "Noise",
  other_work: "Other work",
};

// school_co_op is the Focus Map's own combined category (School and Co-op
// aren't broken out separately there yet — a data-layer decision, not an
// accent-token one, so this intentionally still points at School's series
// token rather than splitting into Co-op's).
const SEGMENT_SERIES_VAR: Record<string, string> = {
  deen: "--series-deen",
  business: "--series-business",
  fitness: "--series-fitness",
  school_co_op: "--series-school",
  noise: "--series-noise",
  other_work: "--series-other",
};

// Segments that map to a real domain get a matching IconChip/accent — noise
// and other_work aren't domains, so they stay a plain color dot.
const SEGMENT_ACCENT: Partial<Record<string, AccentToken>> = {
  deen: "deen",
  business: "business",
  fitness: "fitness",
  school_co_op: "school",
  noise: "noise",
};
const SEGMENT_ICON: Partial<Record<string, typeof DOMAIN_ICON.deen>> = {
  deen: DOMAIN_ICON.deen,
  business: DOMAIN_ICON.business,
  fitness: DOMAIN_ICON.fitness,
  school_co_op: DOMAIN_ICON.school,
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

  const supabase = await createClient();
  const [{ segments }, kpis, weeklyCompletion, { data: snCheckinRows }, rangeSn] = await Promise.all([
    getFocusMap(userId, range, anchor),
    getInsightsKpis(userId, weekStart, previousWeekStart),
    getWeeklyCompletion(userId, now, profile),
    supabase
      .from("checkins")
      .select("window_start, checkin_allocations(domain, minutes)")
      .eq("user_id", userId)
      .eq("kind", "allocation")
      .gte("window_start", snWeeks[0].weekStartIso),
    getSignalNoiseForRange(userId, range, anchor),
  ]);

  const hasFocusData = segments.length > 0;
  const domainSegments = segments.filter((s) => s.domain !== "noise" && s.domain !== "other_work");

  // --- Signal:Noise, allocation-minutes based (2026-08-19 Phase 4 + donut
  // unification): the donut (rangeSn, this day/week) and the 6-week bar
  // trend below now share one source — lib/business/sn-ratio.ts — instead
  // of the donut reading getFocusMap's separate tag_type-count ratio.
  // getFocusMap is segments-only now, still point-sample-based, and only
  // feeds the Focus Map / Per-domain panels further down. ---
  const hasSnData = rangeSn.signalMinutes + rangeSn.noiseMinutes > 0;
  const snAllocationRows: SnAllocationRow[] = (snCheckinRows ?? []).flatMap((c) =>
    (c.checkin_allocations ?? []).map((a) => ({ windowStartIso: c.window_start ?? "", domain: a.domain, minutes: a.minutes }))
  );
  const snByWeek = bucketSignalNoiseByWeek(snAllocationRows, snWeeks);
  const thisWeekSn = snByWeek[snByWeek.length - 1];
  const snBars = snByWeek.map((w) => ({
    label: w.label,
    value: w.noiseMinutes === 0 ? w.signalMinutes / 15 : Math.round((w.signalMinutes / w.noiseMinutes) * 10) / 10,
  }));
  const hasAnySnWeekData = snByWeek.some((w) => w.signalMinutes + w.noiseMinutes > 0);

  const weeklyAvgPct = Math.round(
    weeklyCompletion.weeklyCompletionPct.reduce((a, b) => a + b, 0) / weeklyCompletion.weeklyCompletionPct.length
  );
  const bestDayIndex = weeklyCompletion.weeklyCompletionPct.reduce(
    (best, v, i) => (v > weeklyCompletion.weeklyCompletionPct[best] ? i : best),
    0
  );

  const rankedItems: RankedBarsItem[] = segments.map((s) => ({
    label: SEGMENT_LABEL[s.domain] ?? s.domain,
    value: s.count,
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
              kpis.noiseShareDeltaPct === 0
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
        caption={`${weeklyCompletion.weeklyCompletionLabels[bestDayIndex]} was your best day this week`}
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
              const noiseSegment = segments.find((n) => n.domain === "noise");
              const display = computeRatioDisplay(s.pct, noiseSegment?.pct ?? 0, true);
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
                  <span className="font-mono font-medium tabular-nums">{display}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </PageContainer>
  );
}
