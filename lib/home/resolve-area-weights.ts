import type { UserDomainsState } from "@/lib/domains/get-user-domains";
import { areaWeight } from "@/lib/domains/area-vocabulary";
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

  // Through the 115 bridge. Pre-flatten all three inherit the group row's
  // single tier (unchanged behaviour); post-flatten each carries its OWN
  // tier, which is the entire point of the migration — weight stops being
  // shared by three areas that merely happened to sit under one group.
  // Absence still means the user opted out, exactly as this file's header
  // says: areaWeight widens where we look, it never invents a fallback.
  const deen = areaWeight(state, "faith");
  if (deen) lookup.deen = deen;
  const fitness = areaWeight(state, "body");
  if (fitness) lookup.fitness = fitness;
  const selfMastery = areaWeight(state, "learning");
  if (selfMastery) lookup.self_mastery = selfMastery;

  const school = state.domains.find((d) => d.key === "school");
  if (school) {
    lookup.school = { weightTier: school.weight, position: null };
  }

  return lookup;
}
