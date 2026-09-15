import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserDomainsForUser } from "./user-domains-core";
import type { DomainKey } from "@/app/(app)/onboarding/actions";
import type { WeightTier } from "@/lib/home/arbiter";

export type UserDomainRow = { key: DomainKey; position: number; weight: WeightTier };

export type UserSubdomainRow = {
  domainKey: DomainKey;
  key: string;
  label: string;
  kind: "job" | "business" | null;
  widgets: string[];
  config: Record<string, unknown>;
  position: number;
};

export type UserDomainsState =
  | { mode: "legacy" }
  | { mode: "domains"; domains: UserDomainRow[]; subdomains: UserSubdomainRow[] };

/**
 * The shell-level read: called on every render of the four-tab shell, so it
 * is `cache()`-wrapped (per-request memoization, same pattern as
 * getProfile/getActiveWorkSession) — nothing here adds a round trip beyond
 * whichever call site hits it first in a given request.
 *
 * The legacy failsafe (Opus Lead ruling, M6): an account with
 * `onboarding_completed = true` and zero active `user_domains` rows
 * predates Phase 1's domain-selection onboarding entirely — Ayman's real
 * account and the SEED account are both in exactly this state today,
 * verified live. Selecting zero domains is not a real path a user can take
 * (`saveDomainSelection` rejects an empty array), so this combination can
 * only mean "never went through domain selection," never "chose nothing."
 * A naive data-driven nav would render such an account an empty app, which
 * breaks the one guarantee M6 names. Returning a discriminated
 * `{ mode: "legacy" }` — not an empty `domains: []` — is deliberate: an
 * empty array is exactly the shape a future component treats as "render
 * nothing," where what's actually meant is "render everything, the old
 * way."
 *
 * Never throws. This is a render-path read, same discipline as this
 * morning's getOnboardingState fix — an unauthenticated caller (which
 * should be unreachable in practice, since the shell only calls this after
 * AuthedShell has already redirected) still gets a safe answer rather than
 * an unhandled rejection killing hydration. `{ mode: "legacy" }` is the
 * conservative choice for that case too — the full existing app is the
 * safer of two wrong answers when identity can't be confirmed.
 */
export const getUserDomains = cache(async (): Promise<UserDomainsState> => {
  const user = await getAuthedUser();
  if (!user) {
    return { mode: "legacy" };
  }

  const [profile, supabase] = await Promise.all([getProfile(), createClient()]);

  // The decision itself lives in the cookie-free core so bearer-token callers
  // (the MCP account map) get the identical answer — one implementation.
  return getUserDomainsForUser(supabase as unknown as SupabaseClient, user.id, { onboardingCompleted: profile?.onboarding_completed ?? false });
});
