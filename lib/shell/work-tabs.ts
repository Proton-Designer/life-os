import type { NavSubdomainRef } from "./nav-domain-state";

/** The Work screen's Business tab, if the account has one: the first active `kind:'business'` Work subdomain, in position order (WORK-W1). */
export function firstBusinessTab(workSubdomains: readonly NavSubdomainRef[]): NavSubdomainRef | null {
  return workSubdomains.find((s) => s.kind === "business") ?? null;
}

/** Where /business should land for an account that has a Business tab; null = keep serving /business itself. */
export function businessTabHref(workSubdomains: readonly NavSubdomainRef[]): string | null {
  const tab = firstBusinessTab(workSubdomains);
  return tab ? `/work/${tab.key}` : null;
}
