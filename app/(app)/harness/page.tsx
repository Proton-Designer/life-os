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
import { HarnessInteractive } from "./harness-interactive";

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
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
              chart goes here (Phase C)
            </div>
          </Panel>
          <Panel title="Kill list" controls={<Badge variant="info">3 items</Badge>}>
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
              plain panel, no hero — title + controls only
            </div>
          </Panel>
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
