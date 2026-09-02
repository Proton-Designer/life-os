import type { UserDomainsState } from "@/lib/domains/get-user-domains";
import type { AreaWeightLookup } from "./build-candidates";

/**
 * TRANSITIONAL (R27). Weight lives on the THREE top-level onboarding
 * domains today (personal_growth/work/school) -- not on the six areas the
 * arbiter actually ranks. R27 has already ruled the target shape: Business
 * becomes its own top-level area, co_op becomes a Work subdomain, and
 * weight resolves from a candidate's finest-grained owning row. This
 * function implements ONLY what's real today; when that migration lands,
 * THIS is the one place that needs to change. `AreaWeightLookup` itself
 * (a plain area-key -> tier map, build-candidates.ts) already survives
 * R27 unmodified -- the Lead's own framing: "a function taking 'an area
 * key -> tier' survives R27; one taking 'a top-level domain -> tier'
 * doesn't." Every consumer of this function's OUTPUT needs no changes
 * when R27 lands; only this function's body does.
 *
 * Deen/Fitness/Self-Mastery: Personal Growth's own weight tier (they
 * share it -- it's the only value that exists today), each with its OWN
 * subdomain position from `user_subdomains` -- not Personal Growth's
 * top-level position, which would tie-break Deen against Fitness against
 * Self-Mastery identically and lose the only differentiation
 * `user_subdomains` actually offers.
 *
 * School: its own top-level weight tier. Position is null -- nothing else
 * shares the "school" area to tie-break against.
 *
 * Business and co_op: no entry, matching build-candidates.ts's own
 * documented gap (they have no counterpart in this vocabulary at all).
 * Personal Growth or School simply absent from the user's selection
 * (opted out): the areas under it are absent too, correctly -- there is
 * no data to give them, not a bug to paper over with a fallback.
 */
export function resolveAreaWeights(state: UserDomainsState): AreaWeightLookup {
  if (state.mode === "legacy") return {};

  const lookup: AreaWeightLookup = {};

  const personalGrowth = state.domains.find((d) => d.key === "personal_growth");
  if (personalGrowth) {
    const subdomainPosition = (key: string): number | null =>
      state.subdomains.find((s) => s.domainKey === "personal_growth" && s.key === key)?.position ?? null;
    lookup.deen = { weightTier: personalGrowth.weight, position: subdomainPosition("faith") };
    lookup.fitness = { weightTier: personalGrowth.weight, position: subdomainPosition("fitness") };
    lookup.self_mastery = { weightTier: personalGrowth.weight, position: subdomainPosition("self_mastery") };
  }

  const school = state.domains.find((d) => d.key === "school");
  if (school) {
    lookup.school = { weightTier: school.weight, position: null };
  }

  return lookup;
}
