import { describe, expect, it } from "vitest";
import { resolveAreaWeights } from "../resolve-area-weights";
import type { UserDomainsState } from "@/lib/domains/get-user-domains";

describe("resolveAreaWeights (transitional, R27)", () => {
  it("legacy mode has no weight data at all -- empty lookup, every area falls to the arbiter's 'important' floor", () => {
    expect(resolveAreaWeights({ mode: "legacy" })).toEqual({});
  });

  it("Personal Growth's weight is shared by Deen/Fitness/Self-Mastery, each with its OWN subdomain position", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "personal_growth", position: 0, weight: "essential" }],
      subdomains: [
        { domainKey: "personal_growth", key: "faith", label: "Faith", kind: null, widgets: [], config: {}, position: 0 },
        { domainKey: "personal_growth", key: "self_mastery", label: "Self-Mastery", kind: null, widgets: [], config: {}, position: 1 },
        { domainKey: "personal_growth", key: "fitness", label: "Fitness", kind: null, widgets: [], config: {}, position: 2 },
      ],
    };

    const lookup = resolveAreaWeights(state);

    expect(lookup.deen).toEqual({ weightTier: "essential", position: 0 });
    expect(lookup.self_mastery).toEqual({ weightTier: "essential", position: 1 });
    expect(lookup.fitness).toEqual({ weightTier: "essential", position: 2 });
  });

  it("School gets its own top-level weight tier, position null -- nothing else shares the area to tie-break against", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "school", position: 1, weight: "background" }],
      subdomains: [],
    };

    expect(resolveAreaWeights(state).school).toEqual({ weightTier: "background", position: null });
  });

  it("Business and co_op get no entry at all -- matches build-candidates.ts's own documented gap, never a guessed tier", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [
        { key: "personal_growth", position: 0, weight: "essential" },
        { key: "work", position: 1, weight: "background" },
        { key: "school", position: 2, weight: "important" },
      ],
      subdomains: [],
    };

    const lookup = resolveAreaWeights(state);

    expect(lookup.business).toBeUndefined();
    expect(lookup.co_op).toBeUndefined();
  });

  it("a subdomain the user declined (e.g. Fitness) has no position entry, but still inherits Personal Growth's weight tier -- a real, not-yet-practical edge, not a crash", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "personal_growth", position: 0, weight: "essential" }],
      subdomains: [{ domainKey: "personal_growth", key: "faith", label: "Faith", kind: null, widgets: [], config: {}, position: 0 }],
    };

    const lookup = resolveAreaWeights(state);

    expect(lookup.fitness).toEqual({ weightTier: "essential", position: null });
  });

  it("Personal Growth not selected at all leaves Deen/Fitness/Self-Mastery entirely absent -- no data to give them, not a fallback to invent", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "work", position: 0, weight: "important" }],
      subdomains: [],
    };

    const lookup = resolveAreaWeights(state);

    expect(lookup.deen).toBeUndefined();
    expect(lookup.fitness).toBeUndefined();
    expect(lookup.self_mastery).toBeUndefined();
  });

  it("an empty domains-mode account (zero domains) resolves to an empty lookup, not a crash", () => {
    expect(resolveAreaWeights({ mode: "domains", domains: [], subdomains: [] })).toEqual({});
  });
});
