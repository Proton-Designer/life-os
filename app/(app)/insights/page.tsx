import Link from "next/link";
import { redirect } from "next/navigation";
import { Radar, Volume2, Target } from "lucide-react";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString, getWeekStartDate, addDaysToDateString, resolveLocalTime } from "@/lib/date-utils";
import { getFocusMap } from "@/lib/insights/focus-map";
import { getInsightsKpis } from "@/lib/insights/insights-kpis";
import { computeRatioDisplay } from "@/lib/insights/ratio-display";
import { getWeeklyCompletion } from "@/lib/home/get-weekly-completion";
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

  const [{ segments, globalRatio, signal, noise }, kpis, weeklyCompletion] = await Promise.all([
    getFocusMap(userId, range, anchor),
    getInsightsKpis(userId, weekStart, previousWeekStart),
    getWeeklyCompletion(userId, now, profile),
  ]);

  const hasFocusData = segments.length > 0;
  const hasSnData = signal + noise > 0;
  const domainSegments = segments.filter((s) => s.domain !== "noise" && s.domain !== "other_work");

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
              <DonutChart
                slices={[
                  { label: "Signal", value: signal, colorVar: "--series-business" },
                  { label: "Noise", value: noise, colorVar: "--series-noise" },
                ]}
                centerLabel="Global ratio"
                centerValue={globalRatio}
              />
            ) : (
              <EmptyState
                icon={Volume2}
                message="No check-ins answered in this range yet"
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
