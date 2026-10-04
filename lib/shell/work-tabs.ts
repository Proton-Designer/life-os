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

/**
 * What /work does (WORK-W1b): domains mode with a tab -> redirect to the first one; domains mode with
 * ZERO tabs -> the Work screen plus the tab bar (so a first tab can be added); legacy -> the plain screen.
 */
export function workEntryTarget(
  mode: "legacy" | "domains",
  workSubdomains: readonly NavSubdomainRef[],
  hasWork = true
): { kind: "redirect"; href: string } | { kind: "screen-with-bar" } | { kind: "screen" } {
  if (mode !== "domains") return { kind: "screen" };
  // No Work domain at all: nothing to add a tab to (ensureBusinessWorkTab would throw), so no bar.
  if (!hasWork) return { kind: "screen" };
  if (workSubdomains.length > 0) return { kind: "redirect", href: `/work/${encodeURIComponent(workSubdomains[0].key)}` };
  return { kind: "screen-with-bar" };
}
