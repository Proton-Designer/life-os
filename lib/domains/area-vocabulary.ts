import type { UserDomainsState } from "./get-user-domains";
import type { WeightTier } from "@/lib/home/arbiter";

/**
 * THE ONE PLACE that knows migration 115's before/after vocabulary.
 *
 * 115 flattens Personal Growth: `faith`/`body`/`learning` stop being
 * user_subdomains children of a `personal_growth` user_domains row and
 * become peer TOP-LEVEL rows, and the group row is archived. Two facts
 * make that invisible to every automated gate we have, which is why this
 * module exists instead of six inline `||` clauses:
 *
 *   1. getUserDomains fetches subdomains with `.in("domain_id", <ids of
 *      NON-ARCHIVED domains>)`. The moment the group row is archived its
 *      id leaves that list, so its subdomains are never queried at all --
 *      not filtered downstream, never fetched. `user_subdomains` is
 *      untouched by 115 and it makes no difference: the rows survive in
 *      the table and become unreachable through the only accessor.
 *   2. Every consumer then reads `personal_growth:faith` (etc.) as absent
 *      and concludes the user DESELECTED that area -- which is exactly
 *      what absence legitimately means everywhere else in this codebase.
 *      Faith, Fitness and Self-Mastery vanish from Home, silently, for
 *      every domains-mode user.
 *
 * Row counts stay correct through all of that, so a migration's own
 * verification block cannot see it; `tsc` cannot either (call sites cast
 * `as DomainKey`); and the unit fixtures encode the pre-115 vocabulary, so
 * they agree with the bug. Only an actual render shows it.
 *
 * So each area resolves through an ORDERED pair -- post-115 top-level key
 * first, pre-115 group+subdomain second -- and the first form PRESENT
 * wins. That is correct on BOTH sides of the flatten, in either order,
 * which is what lets the bridge land ahead of the migration as a no-op
 * (amended R38: bridge first, alone; atomicity only when no bridge is
 * possible, since a migration and a deploy can never be atomic anyway).
 *
 * Crucially this preserves what absence means. A user who deselected
 * Faith has neither form present, and still correctly reads as absent --
 * the bridge widens WHERE we look, it never invents a fallback value.
 *
 * The legacy arm is transitional. Drop it only once no production row
 * carries `personal_growth` -- not on a schedule, and not before.
 */
export type Area = "faith" | "body" | "learning";

const AREA_FORMS: Record<Area, { topLevel: string; legacySubdomain: string }> = {
  faith: { topLevel: "faith", legacySubdomain: "faith" },
  body: { topLevel: "body", legacySubdomain: "fitness" },
  learning: { topLevel: "learning", legacySubdomain: "self_mastery" },
};

const LEGACY_GROUP = "personal_growth";

/**
 * True when the user actively tracks this area, in whichever vocabulary is live.
 *
 * LEGACY MODE RETURNS FALSE, AND CALLERS MUST DECIDE WHAT THAT MEANS. There is
 * no single right default, which is why this function does not pick one:
 *
 *   - Self-Mastery did not exist before domain selection, so false is correct.
 *   - Faith and Fitness DID exist in the original app. For any surface that a
 *     legacy account can still see, false is an M6 violation — it would remove
 *     something that account has always had.
 *
 * `computeDomainVisibility` handles this with an explicit `isLegacy ||` per
 * flag, and `weekly-goal-domains.ts` overrides it the same way for Deen goal
 * cards (found by Eng 2 while de-hardcoding the weekly_goals filter — reusing
 * this function's default directly would have made a legacy account's Deen
 * goal card silently disappear). If you are calling hasArea on a path a legacy
 * account can reach, decide the legacy answer deliberately at the call site.
 */
export function hasArea(state: UserDomainsState, area: Area): boolean {
  if (state.mode !== "domains") return false;
  const form = AREA_FORMS[area];
  if (state.domains.some((d) => d.key === form.topLevel)) return true;
  return state.subdomains.some((s) => s.domainKey === LEGACY_GROUP && s.key === form.legacySubdomain);
}

/**
 * The area's weight tier and ordering position, or null when the user does
 * not track it. Post-115 the tier is the area's OWN -- which is the point of
 * the flatten: weight stops being shared across three areas that happened to
 * sit under one group. Pre-115 it is inherited from the group row, exactly as
 * before.
 */
export function areaWeight(
  state: UserDomainsState,
  area: Area
): { weightTier: WeightTier; position: number | null } | null {
  if (state.mode !== "domains") return null;
  const form = AREA_FORMS[area];

  const topLevel = state.domains.find((d) => d.key === form.topLevel);
  if (topLevel) return { weightTier: topLevel.weight, position: topLevel.position };

  const group = state.domains.find((d) => d.key === LEGACY_GROUP);
  if (!group) return null;

  // Presence is decided by the GROUP, not by the child row, and that is
  // deliberate — resolve-area-weights.test.ts locks it: a user who kept
  // Personal Growth but declined Fitness still inherits the group's tier with
  // a null position ("a real, not-yet-practical edge, not a crash"). Returning
  // null here instead would be a silent semantic change on PRE-115 data, which
  // would break this bridge's whole claim to be a no-op until the flatten runs.
  // Whether a declined child should be absent is a separate question from
  // whether this migration is safe, and it is not this commit's to answer.
  const sub = state.subdomains.find((s) => s.domainKey === LEGACY_GROUP && s.key === form.legacySubdomain);
  return { weightTier: group.weight, position: sub?.position ?? null };
}
