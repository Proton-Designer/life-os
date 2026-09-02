// Pure derivation from Engineer 1's getUserDomains() read into exactly what
// the four-tab shell's nav components need to render — no DB/React
// dependency here, matching lib/'s "domain-split business logic, no
// framework code" convention. Deliberately does not import from
// components/onboarding/types.ts: lib/ stays independent of components/.

// Mirrors DomainKey (onboarding/actions.ts) without importing it — lib/ stays
// independent of app/, per this file's header. Widened for migration 115 for
// the same reason: an unnamed key would render undefined through the nav's
// exhaustive lookups.
export type NavDomainKey =
  | "personal_growth"
  | "faith"
  | "body"
  | "learning"
  | "business"
  | "work"
  | "school";

export interface NavDomainRow {
  key: NavDomainKey;
  /** Optional so pre-115 callers and tests need not supply it; used only to order synthesised personal areas. */
  position?: number;
}

export interface NavSubdomainRow {
  domainKey: NavDomainKey;
  key: string;
  label: string;
  kind: "job" | "business" | null;
}

export interface NavSubdomainRef {
  key: string;
  label: string;
  kind: "job" | "business" | null;
}

export interface NavDomainState {
  hasPersonalGrowth: boolean;
  hasWork: boolean;
  hasSchool: boolean;
  /** Ordered as given — callers pass rows already sorted by position. */
  personalSubdomains: NavSubdomainRef[];
  workSubdomains: NavSubdomainRef[];
}

export function computeNavDomainState(domains: NavDomainRow[], subdomains: NavSubdomainRow[]): NavDomainState {
  const domainKeys = new Set(domains.map((d) => d.key));

  const byDomain = (domainKey: NavDomainKey): NavSubdomainRef[] =>
    subdomains.filter((s) => s.domainKey === domainKey).map((s) => ({ key: s.key, label: s.label, kind: s.kind }));

  // Migration 115 archives the personal_growth row, and getUserDomains fetches
  // subdomains by NON-ARCHIVED parent id — so its children stop being fetched
  // entirely and byDomain("personal_growth") returns []. That empties
  // personalSubdomains, and personal/[subdomain]/layout.tsx redirects anything
  // not in that list: every /personal/* route bounced to "/" and the whole
  // Self-Mastery section became unreachable. Confirmed on production before
  // this fix, at 200 with a redirect, not a 404 — nothing errored.
  //
  // THE URL KEYS DO NOT CHANGE. Routes stay on the legacy subdomain segments
  // (/personal/faith, /personal/fitness, /personal/self_mastery) because
  // [subdomain]/page.tsx switches on exactly those and every link in the app
  // hardcodes them. The flatten renamed a DOMAIN key, not a ROUTE, so the new
  // top-level rows are mapped back to the legacy segment they already own.
  const PERSONAL_AREAS: { topLevel: NavDomainKey; key: string; label: string }[] = [
    { topLevel: "faith", key: "faith", label: "Faith" },
    { topLevel: "body", key: "fitness", label: "Fitness" },
    { topLevel: "learning", key: "self_mastery", label: "Self-Mastery" },
  ];

  const personalSubdomains = (): NavSubdomainRef[] => {
    const legacy = byDomain("personal_growth");
    if (legacy.length > 0) return legacy;
    return PERSONAL_AREAS.filter((a) => domainKeys.has(a.topLevel))
      .map((a) => ({ area: a, position: domains.find((d) => d.key === a.topLevel)?.position ?? 0 }))
      .sort((x, y) => x.position - y.position)
      .map(({ area }) => ({ key: area.key, label: area.label, kind: null }));
  };

  return {
    // Post-115 there is no personal_growth row (archived by the flatten), but
    // the nav section it gates still holds the three areas that came out of
    // it — so it is present when EITHER vocabulary says so.
    hasPersonalGrowth:
      domainKeys.has("personal_growth") ||
      domainKeys.has("faith") ||
      domainKeys.has("body") ||
      domainKeys.has("learning"),
    hasWork: domainKeys.has("work"),
    hasSchool: domainKeys.has("school"),
    personalSubdomains: personalSubdomains(),
    workSubdomains: byDomain("work"),
  };
}
