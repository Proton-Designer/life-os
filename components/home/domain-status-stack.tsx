import { ListRow } from "@/components/ui/list-row";
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
  co_op: "Co-op",
};

const DOMAIN_HREF: Record<keyof DomainSnapshots, string> = {
  deen: "/deen",
  business: "/business",
  fitness: "/fitness",
  school: "/school",
  co_op: "/co-op",
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
export function DomainStatusStack({ snapshots, title }: { snapshots: DomainSnapshots; title?: string }) {
  const domains: (keyof DomainSnapshots)[] = ["deen", "business", "fitness", "school", "co_op"];

  return (
    <div className="rounded-2xl border border-border/40 bg-card px-3">
      {title && <div className="px-1 pt-3 text-sm font-medium">{title}</div>}
      <div className="divide-y divide-border/40">
        {domains.map((domain) => {
          const accent = DOMAIN_ACCENT[domain === "co_op" ? "co_op" : domain];
          const pulse = snapshots[domain].pulse;
          return (
            <ListRow
              key={domain}
              href={DOMAIN_HREF[domain]}
              leading={<IconChip icon={DOMAIN_ICON[domain]} accent={accent} size="sm" />}
              label={DOMAIN_LABEL[domain]}
              meta={metricFor(domain, snapshots)}
              trailing={
                <ProgressRing
                  pct={pulse === null ? null : Math.round(pulse * 100)}
                  colorVar={ACCENT_VAR[accent]}
                  size={44}
                  strokeWidth={4}
                />
              }
            />
          );
        })}
      </div>
    </div>
  );
}
