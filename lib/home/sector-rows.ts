import type { UserDomainsState } from "@/lib/domains/get-user-domains";
import { hasArea } from "@/lib/domains/area-vocabulary";
import type { DomainSnapshots } from "@/lib/home/get-domain-snapshots";

/** Which snapshot feeds a row. Business tabs read the business snapshot, job tabs the co-op one. */
export type SectorSnapshotKey = keyof DomainSnapshots;

export type SectorRow = {
  /** Unique within one list (Work tabs use their stable tab key). */
  id: string;
  snapshot: SectorSnapshotKey;
  label: string;
  href: string;
};

/**
 * Home's "Sector progress" rows, built from the account's OWN setup (SECTOR-01) instead of a fixed
 * five-row list:
 *  - LEGACY mode (zero user_domains rows, predates domain selection) keeps today's rows exactly:
 *    Deen (only with Deen Mode), Business, Fitness, School, Work.
 *  - DOMAINS mode: Deen only with Deen Mode AND a faith area; Fitness only with the body area;
 *    School only with the school domain; the work domain contributes ONE ROW PER WORK TAB with the
 *    tab's own label (a business tab reads the business snapshot and a job tab the co-op one; a
 *    work domain with no tabs yet gives a single "Work" row). Nothing for areas the user never
 *    set up. Learning has no Home snapshot, so it has no row (not invented).
 * Order: Deen, business tabs, Fitness, School, job tabs -- the old canonical order, so an account
 * with all of them sees what it saw before.
 */
export function buildSectorRows(state: UserDomainsState, deenMode: boolean): SectorRow[] {
  if (state.mode === "legacy") {
    return [
      ...(deenMode ? [{ id: "deen", snapshot: "deen", label: "Deen", href: "/deen" } as SectorRow] : []),
      { id: "business", snapshot: "business", label: "Business", href: "/business" },
      { id: "fitness", snapshot: "fitness", label: "Fitness", href: "/fitness" },
      { id: "school", snapshot: "school", label: "School", href: "/school" },
      { id: "co_op", snapshot: "co_op", label: "Work", href: "/work" },
    ];
  }

  const domainKeys = new Set(state.domains.map((d) => d.key));
  const tabs = state.subdomains.filter((s) => s.domainKey === "work");
  const hasWork = domainKeys.has("work");
  const tabRow = (t: (typeof tabs)[number]): SectorRow => ({
    id: `work:${t.key}`,
    snapshot: t.kind === "business" ? "business" : "co_op",
    label: t.label,
    href: `/work/${t.key}`,
  });

  const rows: SectorRow[] = [];
  if (deenMode && hasArea(state, "faith")) rows.push({ id: "deen", snapshot: "deen", label: "Deen", href: "/deen" });
  if (hasWork) rows.push(...tabs.filter((t) => t.kind === "business").map(tabRow));
  if (hasArea(state, "body")) rows.push({ id: "fitness", snapshot: "fitness", label: "Fitness", href: "/fitness" });
  if (domainKeys.has("school")) rows.push({ id: "school", snapshot: "school", label: "School", href: "/school" });
  if (hasWork) {
    const jobs = tabs.filter((t) => t.kind !== "business");
    // No tabs at all (work selected, none created yet): one plain Work row, as before tabs existed.
    if (tabs.length === 0) rows.push({ id: "co_op", snapshot: "co_op", label: "Work", href: "/work" });
    else rows.push(...jobs.map(tabRow));
  }
  return rows;
}

/** Which snapshot reads Home must run for these rows: absent areas are skipped, not fetched-then-hidden. */
export function wantedSnapshots(rows: readonly SectorRow[]): Record<SectorSnapshotKey, boolean> {
  const wanted = { deen: false, business: false, fitness: false, school: false, co_op: false };
  for (const r of rows) wanted[r.snapshot] = true;
  return wanted;
}
