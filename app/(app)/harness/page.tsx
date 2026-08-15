import { notFound } from "next/navigation";
import { Target, Moon, GraduationCap, TrendingUp } from "lucide-react";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Panel } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { ListRow } from "@/components/ui/list-row";
import { DeltaPill } from "@/components/ui/delta-pill";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { AreaChart } from "@/components/charts/area-chart";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { Sparkline } from "@/components/charts/sparkline";
import { ProgressRing } from "@/components/charts/progress-ring";
import { ConsistencyGrid } from "@/components/charts/consistency-grid";
import { RankedBars } from "@/components/charts/ranked-bars";
import { HarnessInteractive } from "./harness-interactive";

const PRAYER_STATUS_COLOR = { on_time: "--accent-business", qada: "--accent-deen", missed: "--destructive" };
const PRAYER_STATUS_LABEL = { on_time: "On-time", qada: "Qada", missed: "Missed" };
const DAYS_7 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Temporary visual QA harness for the 2026-08-15 structural refactor's card
// system (Phase B) and chart primitives (Phase C) — a components-only phase
// ships unit tests, not rendered pixels, and that gap is exactly how the
// featured-card transparency defect survived. Delete this route in Phase H.
export default function HarnessPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <PageContainer>
      <PageHeader title="Component Harness" description="Temporary — deleted in Phase H. Not linked from any nav." />

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          KpiCard — Tier 1, always featured, caption mandatory
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={Target}
            accent="business"
            label="Kill list"
            value="1/3"
            caption="2 left, 4h of focus time remaining today"
          />
          <KpiCard
            icon={Moon}
            accent="deen"
            label="Qur'an this week"
            value="42 pages"
            caption="Best week in 3 — up 12 pages from last week"
            delta={{ direction: "up", text: "+12" }}
          />
          <KpiCard
            icon={GraduationCap}
            accent="school"
            label="Due today"
            value="0"
            caption="Nothing due yet — enjoy it"
            delta={{ direction: "flat", text: "No change" }}
          />
          <KpiCard
            icon={Target}
            accent="coop"
            label="Consistency"
            value="80%"
            caption="4/5 days this week"
            delta={{ direction: "down", text: "-1 day" }}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">DeltaPill — up / down / flat</h2>
        <div className="flex gap-3">
          <DeltaPill direction="up" text="+12 pages" />
          <DeltaPill direction="down" text="-4 pages" />
          <DeltaPill direction="flat" text="No change" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          Panel — with and without the one-metric-rule hero header
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel
            title="Signal:Noise by week"
            heroValue="4.2:1"
            delta={{ direction: "up", text: "+0.6 vs last week" }}
            caption="Best week in 3 — up 12 pages from last week"
            controls={
              <SegmentedControl
                options={[
                  { label: "Day", href: "/harness?range=day", active: false },
                  { label: "Week", href: "/harness?range=week", active: true },
                ]}
              />
            }
          >
            <AreaChart
              categories={DAYS_7}
              series={[{ label: "Signal:Noise", colorVar: "--series-business", values: [2.1, 3.4, 1.8, 4.2, 3.9, 5.1, 4.2] }]}
              height={160}
            />
          </Panel>
          <Panel title="Kill list" controls={<Badge variant="info">3 items</Badge>}>
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
              plain panel, no hero — title + controls only
            </div>
          </Panel>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          AreaChart — 1-2 series, one y-axis, hover crosshair
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Qur'an pages per day (2 series)">
            <AreaChart
              categories={DAYS_7}
              series={[
                { label: "Pages read", colorVar: "--series-deen", values: [3, 5, 0, 8, 4, 6, 7] },
                { label: "Daily target", colorVar: "--accent-info", values: [5, 5, 5, 5, 5, 5, 5] },
              ]}
            />
          </Panel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Panel title="Empty state">
              <AreaChart categories={[]} series={[]} height={120} />
            </Panel>
            <Panel title="Single data point">
              <AreaChart
                categories={["Mon"]}
                series={[{ label: "Pages", colorVar: "--series-deen", values: [5] }]}
                height={120}
              />
            </Panel>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          BarChart — single-bar highlight in --accent-info
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Signal:Noise by week, this week highlighted">
            <BarChart
              bars={[
                { label: "W1", value: 2.1 },
                { label: "W2", value: 3.4 },
                { label: "W3", value: 1.8 },
                { label: "W4", value: 4.2 },
              ]}
              colorVar="--series-business"
              highlightIndex={3}
            />
          </Panel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Panel title="Empty state">
              <BarChart bars={[]} colorVar="--series-business" height={120} />
            </Panel>
            <Panel title="Single bar">
              <BarChart bars={[{ label: "W1", value: 3 }]} colorVar="--series-business" height={120} />
            </Panel>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          DonutChart — 2-3 slices, center total
        </h2>
        <div className="flex flex-wrap gap-6">
          <Panel title="Global Signal:Noise">
            <DonutChart
              slices={[
                { label: "Signal", value: 42, colorVar: "--accent-business" },
                { label: "Noise", value: 10, colorVar: "--accent-noise" },
              ]}
              centerLabel="Signal:Noise"
              centerValue="4.2:1"
            />
          </Panel>
          <Panel title="Empty state (zero check-ins)">
            <DonutChart
              slices={[
                { label: "Signal", value: 0, colorVar: "--accent-business" },
                { label: "Noise", value: 0, colorVar: "--accent-noise" },
              ]}
              centerLabel="Signal:Noise"
              centerValue="No data"
            />
          </Panel>
          <Panel title="Single slice (all signal)">
            <DonutChart
              slices={[{ label: "Signal", value: 12, colorVar: "--accent-business" }]}
              centerLabel="Signal:Noise"
              centerValue="All signal"
            />
          </Panel>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          Sparkline + ProgressRing — compact, no axes/legend
        </h2>
        <div className="flex flex-wrap items-center gap-8">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Normal (7 pts)</span>
            <Sparkline values={[3, 5, 0, 8, 4, 6, 7]} colorVar="--series-deen" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Empty</span>
            <Sparkline values={[]} colorVar="--series-deen" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Single point</span>
            <Sparkline values={[5]} colorVar="--series-deen" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Zero variance</span>
            <Sparkline values={[3, 3, 3, 3]} colorVar="--series-deen" />
          </div>
          <div className="flex items-center gap-4">
            <ProgressRing pct={68} colorVar="--accent-deen" />
            <ProgressRing pct={0} colorVar="--accent-business" />
            <ProgressRing pct={100} colorVar="--accent-school" />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          ConsistencyGrid — ordered status heatmap
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Prayer consistency, last 7 days">
            <ConsistencyGrid
              rows={[
                { label: "Fajr", cells: DAYS_7.map((d, i) => ({ date: d, status: ["on_time", "qada", "missed"][i % 3] })) },
                { label: "Dhuhr", cells: DAYS_7.map((d) => ({ date: d, status: "on_time" })) },
                { label: "Asr", cells: DAYS_7.map((d, i) => ({ date: d, status: i < 4 ? "on_time" : "missed" })) },
              ]}
              statusColorVar={PRAYER_STATUS_COLOR}
              statusLabel={PRAYER_STATUS_LABEL}
            />
          </Panel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Panel title="Empty state">
              <ConsistencyGrid rows={[]} statusColorVar={PRAYER_STATUS_COLOR} statusLabel={PRAYER_STATUS_LABEL} />
            </Panel>
            <Panel title="Single row, single day">
              <ConsistencyGrid
                rows={[{ label: "Fajr", cells: [{ date: "Today", status: "on_time" }] }]}
                statusColorVar={PRAYER_STATUS_COLOR}
                statusLabel={PRAYER_STATUS_LABEL}
              />
            </Panel>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          RankedBars — Focus Map&apos;s 7-category form (not a donut)
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Focus Map">
            <RankedBars
              items={[
                { label: "Deen", value: 28, colorVar: "--series-deen" },
                { label: "Business", value: 42, colorVar: "--series-business" },
                { label: "School", value: 15, colorVar: "--series-school" },
                { label: "Co-op", value: 8, colorVar: "--series-coop" },
                { label: "Fitness", value: 12, colorVar: "--series-fitness" },
                { label: "Noise", value: 6, colorVar: "--series-noise" },
                { label: "Other work", value: 9, colorVar: "--series-other" },
              ]}
            />
          </Panel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Panel title="Empty state">
              <RankedBars items={[]} />
            </Panel>
            <Panel title="Single item">
              <RankedBars items={[{ label: "Deen", value: 10, colorVar: "--series-deen" }]} />
            </Panel>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">StatTile — Tier 3, clustered</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile icon={Moon} accent="deen" label="Streak" value="6 days" delta={{ direction: "up", text: "+2" }} />
          <StatTile icon={Target} accent="business" label="Sessions" value="3" />
          <StatTile icon={GraduationCap} accent="school" label="Assignments" value="2" />
          <StatTile icon={TrendingUp} accent="info" label="Focus" value="72%" delta={{ direction: "down", text: "-5%" }} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          ListRow — Tier 4, divide-y container, min-h-[52px]
        </h2>
        <div className="divide-y divide-border/40 rounded-2xl border border-border/40 bg-card px-3">
          <ListRow
            leading={<span className="size-2 rounded-full bg-accent-deen" />}
            label="Fajr"
            trailing={<Badge variant="positive">On-time</Badge>}
            meta="5:12 AM"
          />
          <ListRow
            leading={<span className="size-2 rounded-full bg-accent-business" />}
            label="Finish the deck"
            trailing={<Badge variant="warning">Due soon</Badge>}
            href="/business"
          />
          <ListRow
            leading={<span className="size-2 rounded-full bg-muted" />}
            label="Static row, no href/onClick"
            meta="Today"
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
          SegmentedControl (value mode) + EmptyState (both action modes, and none)
        </h2>
        <HarnessInteractive />
      </section>
    </PageContainer>
  );
}
