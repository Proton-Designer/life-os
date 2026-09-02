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
    personalSubdomains: byDomain("personal_growth"),
    workSubdomains: byDomain("work"),
  };
}
