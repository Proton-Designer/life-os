import { describe, expect, it } from "vitest";
import { classifyDomain, type DomainWeights } from "../domain-classification";

describe("classifyDomain — legacy mode (weights: null)", () => {
  it("reproduces today's exact split: deen and business are signal", () => {
    expect(classifyDomain("deen", null)).toBe("signal");
    expect(classifyDomain("business", null)).toBe("signal");
  });

  it("school, fitness, co_op are other", () => {
    expect(classifyDomain("school", null)).toBe("other");
    expect(classifyDomain("fitness", null)).toBe("other");
    expect(classifyDomain("co_op", null)).toBe("other");
  });

  // The original bucketAllocationMinutes explicitly ignored an unrecognized
  // domain rather than counting it as noise ("better a gap than a
  // miscounted total") — classifyDomain must preserve that third outcome,
  // not silently collapse it into "other" the way a naive signal/not-
  // signal boolean would.
  it("an unrecognized domain is its own outcome, not silently 'other'", () => {
    expect(classifyDomain("bogus", null)).toBe("unrecognized");
  });
});

describe("classifyDomain — domains mode (real weights, R10 tiers)", () => {
  it("deen and fitness both follow Personal Growth's tier — they share a top-level domain, weight is top-level only", () => {
    const essential: DomainWeights = { personal_growth: "essential", school: "important" };
    expect(classifyDomain("deen", essential)).toBe("signal");
    expect(classifyDomain("fitness", essential)).toBe("signal");

    const important: DomainWeights = { personal_growth: "important", school: "essential" };
    expect(classifyDomain("deen", important)).toBe("other");
    expect(classifyDomain("fitness", important)).toBe("other");
  });

  it("school follows its own top-level tier, independent of Personal Growth", () => {
    const weights: DomainWeights = { personal_growth: "important", school: "essential" };
    expect(classifyDomain("school", weights)).toBe("signal");
  });

  it("background tier is other, same as important — only essential is signal", () => {
    const weights: DomainWeights = { personal_growth: "background" };
    expect(classifyDomain("deen", weights)).toBe("other");
  });

  it("a top-level domain the user never selected at all classifies as other, not signal by default", () => {
    const weights: DomainWeights = { work: "essential" }; // personal_growth/school absent entirely
    expect(classifyDomain("deen", weights)).toBe("other");
    expect(classifyDomain("school", weights)).toBe("other");
  });

  // business/co_op have no subdomain equivalent in the new model yet
  // (Work-subdomain-scoped allocation, T-0002, hasn't landed) — they keep
  // their pre-migration legacy classification in EVERY mode, rather than
  // silently losing representation or getting an arbitrary tier assigned.
  it("business and co_op are unmapped — they keep legacy classification regardless of the user's real weights", () => {
    const weights: DomainWeights = { personal_growth: "background", school: "background", work: "background" };
    expect(classifyDomain("business", weights)).toBe("signal");
    expect(classifyDomain("co_op", weights)).toBe("other");
  });

  it("a user-created Work subdomain key is unrecognized, not silently counted as other-commitment noise", () => {
    const weights: DomainWeights = { work: "essential" };
    expect(classifyDomain("acme_inc", weights)).toBe("unrecognized");
  });
});

/**
 * Migration 115 (flatten Personal Growth) changes what an ABSENT key means,
 * and that is the whole hazard. Before 115, `personal_growth` missing from a
 * non-null weights map means the user DESELECTED it in onboarding — a real
 * answer, correctly classified "other" by the test above. After 115 the same
 * absence means only that the key no longer exists in the model, because a
 * migration archived the row. Same absence, two meanings.
 *
 * So the fix is NOT to treat an absent tier as a fallback (that would erase
 * deselection, turning a real user decision into missing data). It is to map
 * the frozen legacy vocabulary onto keys that still EXIST after the flatten,
 * so that absence goes back to meaning exactly one thing: the user deselected
 * this area.
 *
 * The dual-vocabulary bridge below also closes the deploy window. A migration
 * and a deploy cannot be atomic with each other, so whichever lands first
 * leaves a gap where one vocabulary is live and the other is not; resolving
 * through the first key PRESENT keeps classification correct on both sides of
 * that gap, in either order.
 */
describe("classifyDomain — across migration 115's vocabulary change", () => {
  it("post-115: deen follows Faith's own tier, fitness follows Body's — they no longer share one group tier", () => {
    const weights: DomainWeights = { faith: "essential", body: "background", work: "important" };
    expect(classifyDomain("deen", weights)).toBe("signal");
    expect(classifyDomain("fitness", weights)).toBe("other");
  });

  it("pre-115 weights still classify identically — the bridge reads whichever vocabulary is live", () => {
    const weights: DomainWeights = { personal_growth: "essential", school: "important" };
    expect(classifyDomain("deen", weights)).toBe("signal");
    expect(classifyDomain("fitness", weights)).toBe("signal");
  });

  // The regression this whole commit exists to prevent: without the remap,
  // post-115 weights lack `personal_growth`, the lookup returns undefined,
  // and Ayman's 2026-08-19 ruling ("Signal = Deen + Business") is silently
  // reversed for every domains-mode user.
  it("a Faith-essential user's Deen time is signal after the flatten, not noise", () => {
    const weights: DomainWeights = { faith: "essential", body: "important", learning: "background", work: "important" };
    expect(classifyDomain("deen", weights)).toBe("signal");
  });

  // Deselection must survive the remap intact — this is the semantic the
  // pre-existing "never selected at all" test locks, and it stays locked.
  it("deselection still means other: a user who dropped Faith gets no signal from Deen", () => {
    const weights: DomainWeights = { body: "essential", work: "essential" };
    expect(classifyDomain("deen", weights)).toBe("other");
  });

  it("business and co_op keep legacy classification through the flatten — still unmapped, still not silently retiered", () => {
    const weights: DomainWeights = { faith: "background", body: "background", work: "background" };
    expect(classifyDomain("business", weights)).toBe("signal");
    expect(classifyDomain("co_op", weights)).toBe("other");
  });
});
