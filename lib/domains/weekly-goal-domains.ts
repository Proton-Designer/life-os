import type { UserDomainsState } from "./get-user-domains";
import { hasArea } from "./area-vocabulary";

/**
 * Which legacy `weekly_goals.domain` values ("deen" | "business") should be
 * queried/shown for this user — replaces a bare `.in("domain", ["deen",
 * "business"])` literal (page.tsx, calendar/actions.ts) that silently
 * assumed every user has both forever. Same failure shape as the six
 * reader modules migration 115 broke: a hardcoded value list is
 * indistinguishable, once it excludes something, from the user never
 * having the data.
 *
 * "deen": legacy mode always includes it (M6 — Faith existed in the
 * original app, unlike Self-Mastery, so a legacy account must see it
 * exactly as before). Domains-mode follows hasArea(state, "faith")
 * — a user who deselected Faith should not see a stray Deen goal card.
 * This is the OPPOSITE default from hasArea's own legacy handling
 * (which returns false for legacy — correct for Self-Mastery, which
 * never existed pre-domain-selection); do not reuse hasArea's legacy
 * branch here without this override, or a legacy account's Deen card
 * silently disappears.
 *
 * "business": unconditionally included in every mode. Business is not
 * yet a selectable/deselectable onboarding area (R27 adds it to the
 * picker; that onboarding path doesn't exist yet) — every account,
 * legacy or domains-mode, has always been able to set a Business weekly
 * goal regardless of domain selection, and narrowing this before Business
 * is real in the model would be a live regression, not a fix. Revisit
 * once Business has a real user_domains row to check.
 */
export function weeklyGoalDomains(state: UserDomainsState): ("deen" | "business")[] {
  const includeDeen = state.mode === "legacy" || hasArea(state, "faith");
  return includeDeen ? ["deen", "business"] : ["business"];
}
