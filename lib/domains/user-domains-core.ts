import type { SupabaseClient } from "@supabase/supabase-js";
import type { DomainKey } from "@/app/(app)/onboarding/actions";
import type { WeightTier } from "@/lib/home/arbiter";
import type { UserDomainsState } from "./get-user-domains";

/**
 * The cookie-free half of `getUserDomains()` (lib/domains/get-user-domains.ts):
 * the SAME legacy/domains decision for any client + userId, so a bearer-token
 * caller (the MCP account map, P4-03) gets exactly the answer the nav gets.
 * `getUserDomains()` delegates here, so there is one implementation, not two.
 *
 * Legacy failsafe (Opus Lead ruling, M6 — see get-user-domains.ts for the full
 * reasoning): `onboarding_completed = true` AND zero active `user_domains`
 * rows means "predates domain selection", never "chose nothing".
 *
 * `onboardingCompleted` may be passed by a caller that already loaded the
 * profile (the cookie path's cached getProfile()); otherwise it is read here.
 * Throws on a query error, like the original.
 */
export async function getUserDomainsForUser(
  supabase: SupabaseClient,
  userId: string,
  opts: { onboardingCompleted?: boolean } = {},
): Promise<UserDomainsState> {
  let onboardingCompleted = opts.onboardingCompleted;
  if (onboardingCompleted === undefined) {
    const { data: profile, error: profileError } = await supabase.from("profiles").select("onboarding_completed").eq("user_id", userId).maybeSingle();
    if (profileError) throw profileError;
    onboardingCompleted = (profile as { onboarding_completed?: boolean } | null)?.onboarding_completed ?? false;
  }

  const { data: domainRows, error: domainsError } = await supabase
    .from("user_domains")
    .select("id, key, position, weight")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("position", { ascending: true });
  if (domainsError) throw domainsError;

  const domains = (domainRows ?? []) as { id: string; key: DomainKey; position: number; weight: WeightTier }[];

  if (onboardingCompleted && domains.length === 0) {
    return { mode: "legacy" };
  }

  if (domains.length === 0) {
    return { mode: "domains", domains: [], subdomains: [] };
  }

  const domainIdToKey = new Map(domains.map((d) => [d.id, d.key]));
  const { data: subdomainRows, error: subdomainsError } = await supabase
    .from("user_subdomains")
    .select("domain_id, key, label, kind, widgets, config, position")
    .eq("user_id", userId)
    .in(
      "domain_id",
      domains.map((d) => d.id),
    )
    .is("archived_at", null)
    .order("position", { ascending: true });
  if (subdomainsError) throw subdomainsError;

  type SubdomainRow = { domain_id: string; key: string; label: string; kind: string | null; widgets: unknown; config: unknown; position: number };
  return {
    mode: "domains",
    domains: domains.map((d) => ({ key: d.key, position: d.position, weight: d.weight })),
    subdomains: ((subdomainRows ?? []) as SubdomainRow[]).map((s) => ({
      domainKey: domainIdToKey.get(s.domain_id) as DomainKey,
      key: s.key,
      label: s.label,
      kind: (s.kind as "job" | "business" | null) ?? null,
      widgets: (s.widgets ?? []) as string[],
      config: (s.config ?? {}) as Record<string, unknown>,
      position: s.position,
    })),
  };
}
