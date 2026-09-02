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
