import Link from "next/link";
import { IconChip } from "@/components/ui/icon-chip";
import { ProgressRing } from "@/components/charts/progress-ring";
import { ACCENT_VAR, DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import type { DomainSnapshots } from "@/lib/home/get-domain-snapshots";

const DOMAIN_LABEL: Record<keyof DomainSnapshots, string> = {
  deen: "Deen",
  business: "Business",
  fitness: "Fitness",
  school: "School",
  co_op: "Work",
};

const DOMAIN_HREF: Record<keyof DomainSnapshots, string> = {
  deen: "/deen",
  business: "/business",
  fitness: "/fitness",
  school: "/school",
  co_op: "/work",
};

function metricFor(domain: keyof DomainSnapshots, s: DomainSnapshots): string {
  switch (domain) {
    case "deen": {
      const done = s.deen.prayerStatuses.filter((p) => p.status === "on_time" || p.status === "qada").length;
      const base = `${done}/5 prayers`;
      // No new element — the existing metric is the doorway. Outstanding
      // qada is invisible otherwise once a missed-and-unlogged prayer drops
      // out of Home's actionable items (it's qada, not "pending").
      return s.deen.qadaBacklogCount > 0 ? `${base} · ${s.deen.qadaBacklogCount} qada` : base;
    }
    case "business":
      return `Kill list ${s.business.killListDone}/${s.business.killListTotal || 3}`;
    case "fitness":
      return `${Math.round(s.fitness.weeklyConsistency * 100)}% this week`;
    case "school":
      return `${s.school.dueTodayCount} due today`;
    case "co_op":
      return `${s.co_op.dueTodayCount} due today`;
  }
}

// The ONLY place Home shows domain-scoped status, per the one-metric rule.
// Horizontal, not a vertical list (2026-08-20 relocation to the top of
// Home) — each sector is its own card with name+metric on one side and the
// progress ring on the other ("side by side" per Ayman), snap-scrolling on
// mobile like every other top-of-page strip in this app (Deen/Insights/
// Weekly Planning's own KPI rows) rather than a bespoke mobile treatment.
export function DomainStatusStack({ snapshots, title }: { snapshots: DomainSnapshots; title?: string }) {
  const domains: (keyof DomainSnapshots)[] = ["deen", "business", "fitness", "school", "co_op"];

  return (
    <div className="flex flex-col gap-2">
      {title && <p className="text-sm font-medium">{title}</p>}
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-5 md:overflow-visible">
        {domains.map((domain) => {
          const accent = DOMAIN_ACCENT[domain === "co_op" ? "co_op" : domain];
          const pulse = snapshots[domain].pulse;
          return (
            <Link
              key={domain}
              href={DOMAIN_HREF[domain]}
              className="flex w-[46vw] shrink-0 snap-start items-center justify-between gap-2 rounded-2xl border border-border/40 bg-card p-3 text-left transition-colors hover:bg-foreground/[0.03] md:w-auto"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <IconChip icon={DOMAIN_ICON[domain]} accent={accent} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{DOMAIN_LABEL[domain]}</p>
                  <p className="truncate text-xs text-muted-foreground">{metricFor(domain, snapshots)}</p>
                </div>
              </div>
              <ProgressRing
                pct={pulse === null ? null : Math.round(pulse * 100)}
                colorVar={ACCENT_VAR[accent]}
                size={40}
                strokeWidth={4}
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
