/**
 * Ruling (c): SIGNAL_DOMAINS -> user data, via R10's weight tiers.
 *
 * "Coverage semantics" (Opus Lead's instruction): signal is whatever the
 * user has ranked essential; everything else they still track is an other
 * commitment; unaccounted time stays wasted, computed exactly as before.
 * For a legacy-mode account (weights: null — no user_domains rows, the
 * account predates domain selection entirely) this reproduces today's
 * exact hardcoded split (deen+business = signal) — zero regression for the
 * one account this matters most for.
 *
 * The bridge this module owns: `deen`/`business`/`fitness`/`school`/`co_op`
 * are the frozen legacy domain vocabulary (D-005 — stored forever, never
 * renamed); `personal_growth`/`work`/`school` are the new user-owned
 * top-level model R10's weight lives on. `deen` and `fitness` BOTH map to
 * Personal Growth (Faith and Fitness are its subdomains, and weight is
 * scoped to the TOP-LEVEL domain only, per the Boss's explicit framing) —
 * so they share one tier. That is a real, visible behavior change from
 * today's manual curation (which treated deen as signal and fitness as
 * not), and it is intentional, not an oversight: coverage semantics means
 * "what you ranked essential," not "what Ayman specifically picked in
 * 2026-08-19" — a domains-mode user who ranks Personal Growth essential is
 * saying Faith AND Fitness both matter to them, together.
 *
 * `business`/`co_op` have no subdomain equivalent in the new model at all
 * yet (Work-subdomain-scoped allocation, T-0002, hasn't landed) — they
 * keep their pre-migration legacy classification in every mode, since
 * dropping them or assigning an arbitrary tier would silently lose or
 * misclassify real user time that the new model simply hasn't caught up
 * to representing yet.
 */

export type DomainWeightTier = "essential" | "important" | "background";

/** A domains-mode user's real weights, keyed by TOP-LEVEL domain (user_domains.key) — not by legacy domain, not by subdomain. */
export type DomainWeights = Partial<
  Record<"personal_growth" | "faith" | "body" | "learning" | "business" | "work" | "school", DomainWeightTier>
>;

// Migration 115 flattens Personal Growth: `faith`/`body`/`learning` become
// peer top-level rows and the `personal_growth` group row is archived, so
// getUserDomainWeights (active rows only) stops returning that key at all.
//
// Each legacy domain therefore resolves through an ORDERED candidate list —
// post-115 key first, pre-115 group key second — and the first key PRESENT
// in the map wins. Two reasons it is a list rather than a straight remap:
//
//   1. A migration and a deploy cannot be atomic with each other. Whichever
//      lands first leaves a window where one vocabulary is live and the
//      other is not; reading the first present key is correct on both sides
//      of that window, in either order, so there is no window at all.
//   2. It keeps ABSENCE meaning exactly one thing. Before 115, a missing
//      `personal_growth` meant the user DESELECTED it in onboarding — a real
//      answer, and "other" is the right classification for it. After 115 the
//      same absence would have meant only "this key no longer exists,"
//      silently reversing Ayman's 2026-08-19 ruling for every domains-mode
//      user. Mapping onto keys that still exist restores the single meaning;
//      falling back to the legacy split on an absent tier would have
//      destroyed it, by turning a deliberate deselection into missing data.
//
// The `personal_growth` arm is transitional. It can be dropped once no
// production row carries that key — not before, and not on a schedule.
const LEGACY_TO_TOP_LEVEL: Partial<Record<string, ReadonlyArray<keyof DomainWeights>>> = {
  deen: ["faith", "personal_growth"],
  fitness: ["body", "personal_growth"],
  school: ["school"],
};

// The 5 legacy domain values this whole classification universe is defined
// over. Anything outside this set is "unrecognized" (see below), never
// silently folded into "other" — that distinction is load-bearing: the
// original bucketAllocationMinutes explicitly ignored an unrecognized
// domain string rather than counting it as noise ("better a gap than a
// miscounted total"), and a Work subdomain key isn't wired into Signal:
// Noise tagging at all yet (T-0002), so treating an arbitrary new key as
// real "other commitment" time would inflate the noise total with minutes
// this system was never asked to measure.
const RECOGNIZED_LEGACY_DOMAINS = new Set(["deen", "business", "fitness", "school", "co_op"]);

// Legacy fallback — Ayman's 2026-08-19 ruling, unchanged: "Signal = Deen +
// Business... I can't include everything under signal, it has to be
// priority based." Used both for weights === null (true legacy mode) AND
// for business/co_op specifically in every mode, since neither has a real
// mapping into the new model yet.
const LEGACY_SIGNAL = new Set(["deen", "business"]);

export type DomainClassification = "signal" | "other" | "unrecognized";

export function classifyDomain(domain: string, weights: DomainWeights | null): DomainClassification {
  if (!RECOGNIZED_LEGACY_DOMAINS.has(domain)) return "unrecognized";

  const candidates = LEGACY_TO_TOP_LEVEL[domain];
  if (weights === null || candidates === undefined) {
    return LEGACY_SIGNAL.has(domain) ? "signal" : "other";
  }

  // First candidate PRESENT wins. An absent tier after every candidate has
  // been tried is a deselected area, not missing data — "other", never the
  // legacy fallback.
  let tier: DomainWeightTier | undefined;
  for (const key of candidates) {
    const candidate = weights[key];
    if (candidate !== undefined) {
      tier = candidate;
      break;
    }
  }
  return tier === "essential" ? "signal" : "other";
}
