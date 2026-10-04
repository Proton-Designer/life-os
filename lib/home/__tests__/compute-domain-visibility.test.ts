import { describe, expect, it } from "vitest";
import { computeDomainVisibility } from "../compute-domain-visibility";
import type { UserDomainsState } from "@/lib/domains/get-user-domains";

describe("computeDomainVisibility", () => {
  it("M6: a legacy account (mode: 'legacy') sees every flag true -- renders exactly the original app, unchanged", () => {
    const legacy: UserDomainsState = { mode: "legacy" };
    expect(computeDomainVisibility(legacy, true)).toEqual({
      hasFaith: true,
      hasFitness: true,
      hasWork: true,
      hasSchoolDomain: true,
    });
  });

  it("a domains-mode account with zero active subdomains/domains sees every flag false -- not the legacy default", () => {
    const empty: UserDomainsState = { mode: "domains", domains: [], subdomains: [] };
    expect(computeDomainVisibility(empty, true)).toEqual({
      hasFaith: false,
      hasFitness: false,
      hasWork: false,
      hasSchoolDomain: false,
    });
  });

  it("gates Deen/Fitness on the PERSONAL GROWTH SUBDOMAIN specifically -- Personal Growth kept, Fitness dropped, Faith kept", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "personal_growth", position: 0, weight: "important" }],
      subdomains: [
        {
          domainKey: "personal_growth",
          key: "faith",
          label: "Faith",
          kind: null,
          widgets: [],
          config: {},
          position: 0,
        },
      ],
    };
    const result = computeDomainVisibility(state, true);
    expect(result.hasFaith).toBe(true);
    expect(result.hasFitness).toBe(false);
  });

  it("gates Work on the top-level 'work' domain, independent of Personal Growth's subdomains", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "work", position: 0, weight: "important" }],
      subdomains: [],
    };
    const result = computeDomainVisibility(state, true);
    expect(result.hasWork).toBe(true);
    expect(result.hasFaith).toBe(false);
    expect(result.hasFitness).toBe(false);
    expect(result.hasSchoolDomain).toBe(false);
  });

  it("gates School on the top-level 'school' domain", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "school", position: 0, weight: "important" }],
      subdomains: [],
    };
    expect(computeDomainVisibility(state, true).hasSchoolDomain).toBe(true);
  });

  it("Self-Mastery being selected does not turn on any of these flags -- it has no old-domain equivalent, gated separately by the caller", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "personal_growth", position: 0, weight: "important" }],
      subdomains: [
        {
          domainKey: "personal_growth",
          key: "self_mastery",
          label: "Self-Mastery",
          kind: null,
          widgets: [],
          config: {},
          position: 0,
        },
      ],
    };
    expect(computeDomainVisibility(state, true)).toEqual({
      hasFaith: false,
      hasFitness: false,
      hasWork: false,
      hasSchoolDomain: false,
    });
  });
});

describe("computeDomainVisibility — Deen Mode OFF is the single choke point (D2)", () => {
  const ALL_FALSE_FAITH = { hasFitness: true, hasWork: true, hasSchoolDomain: true };

  it("legacy account + OFF: Faith hidden, everything else exactly as before", () => {
    expect(computeDomainVisibility({ mode: "legacy" }, false)).toEqual({ hasFaith: false, ...ALL_FALSE_FAITH });
  });

  it("domains account WITH a faith row + OFF: Faith still hidden (a user_domains faith row alone must not show it)", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [
        { key: "faith", position: 0, weight: "essential" },
        { key: "body", position: 1, weight: "important" },
        { key: "work", position: 2, weight: "important" },
        { key: "school", position: 3, weight: "important" },
      ],
      subdomains: [],
    };
    expect(computeDomainVisibility(state, false).hasFaith).toBe(false);
    expect(computeDomainVisibility(state, true).hasFaith).toBe(true); // positive control
  });
});
