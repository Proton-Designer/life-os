import Link from "next/link";
import { IconChip } from "@/components/ui/icon-chip";
import { ProgressRing } from "@/components/charts/progress-ring";
import { ACCENT_VAR, DOMAIN_ACCENT } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import { cn } from "@/lib/utils";
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

// "0/5 prayers" with a 0% ring conflates two different facts: the day
// hasn't started yet (nothing to report), and the day closed with nothing
// logged (a real, deserved zero). Only the second is actually "0" — the
// first is "not tracked yet," same as the calm dash Business/Fitness/
// School/Work already show for their own no-data case (2026-08-26,
// post-wipe rehearsal finding). Distinguished by whether any of today's
// prayer windows are still open (`upcoming`/`pending`, from the same
// effectivePrayerStatus derivation the Salah panel uses) — if one is,
// the day can't have "failed" yet, no matter what the count reads.
function deenDayOpenWithNothingLogged(deen: DomainSnapshots["deen"]): boolean {
  const done = deen.prayerStatuses.filter((p) => p.status === "on_time" || p.status === "qada").length;
  if (done > 0) return false;
  return deen.prayerStatuses.some((p) => p.status === "upcoming" || p.status === "pending");
}

function metricFor(domain: keyof DomainSnapshots, s: DomainSnapshots): string {
  switch (domain) {
    case "deen": {
      const done = s.deen.prayerStatuses.filter((p) => p.status === "on_time" || p.status === "qada").length;
      const base = deenDayOpenWithNothingLogged(s.deen) ? "Not tracked yet" : `${done}/5 prayers`;
      // No new element — the existing metric is the doorway. Outstanding
      // qada is invisible otherwise once a missed-and-unlogged prayer drops
      // out of Home's actionable items (it's qada, not "pending"). Kept
      // even in the "not tracked yet" case — a real backlog from PAST days
      // is informative regardless of whether today has started.
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
const ALL_DOMAINS: (keyof DomainSnapshots)[] = ["deen", "business", "fitness", "school", "co_op"];

// Static per-count classes -- Tailwind's JIT can't resolve a template-string
// class name, and this stays a plain lookup rather than an arbitrary-value
// class (`md:grid-cols-[3]`) to match this component's own existing
// CHIP_SIZE_CLASS-shaped convention elsewhere in the codebase.
const GRID_COLS_CLASS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  5: "md:grid-cols-5",
};

export function DomainStatusStack({
  snapshots,
  title,
  visibleDomains = ALL_DOMAINS,
}: {
  snapshots: DomainSnapshots;
  title?: string;
  /** Defaults to all 5 — every existing caller (a legacy account, or any
   * caller that predates domain selection) keeps seeing exactly what it
   * does today unless it explicitly opts into gating. Home is the only
   * caller that passes this, scoped to the caller's actually-selected
   * domains/subdomains (Deen/Fitness map to Personal Growth subdomains,
   * not the top-level domain itself — someone who kept Personal Growth but
   * dropped Fitness should not see a Fitness sector). */
  visibleDomains?: (keyof DomainSnapshots)[];
}) {
  const domains = visibleDomains;
  if (domains.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {title && <p className="text-sm font-medium">{title}</p>}
      <div
        className={cn(
          "flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:grid md:overflow-visible",
          GRID_COLS_CLASS[domains.length] ?? GRID_COLS_CLASS[5]
        )}
      >
        {domains.map((domain) => {
          const accent = DOMAIN_ACCENT[domain === "co_op" ? "co_op" : domain];
          const pulse =
            domain === "deen" && deenDayOpenWithNothingLogged(snapshots.deen) ? null : snapshots[domain].pulse;
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
