import { describe, expect, it } from "vitest";
import { computeDomainVisibility } from "../compute-domain-visibility";
import type { UserDomainsState } from "@/lib/domains/get-user-domains";

describe("computeDomainVisibility", () => {
  it("M6: a legacy account (mode: 'legacy') sees every flag true -- renders exactly the original app, unchanged", () => {
    const legacy: UserDomainsState = { mode: "legacy" };
    expect(computeDomainVisibility(legacy)).toEqual({
      hasFaith: true,
      hasFitness: true,
      hasWork: true,
      hasSchoolDomain: true,
    });
  });

  it("a domains-mode account with zero active subdomains/domains sees every flag false -- not the legacy default", () => {
    const empty: UserDomainsState = { mode: "domains", domains: [], subdomains: [] };
    expect(computeDomainVisibility(empty)).toEqual({
      hasFaith: false,
      hasFitness: false,
      hasWork: false,
      hasSchoolDomain: false,
    });
  });

  it("gates Deen/Fitness on the PERSONAL GROWTH SUBDOMAIN specifically -- Personal Growth kept, Fitness dropped, Faith kept", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "personal_growth", position: 0 }],
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
    const result = computeDomainVisibility(state);
    expect(result.hasFaith).toBe(true);
    expect(result.hasFitness).toBe(false);
  });

  it("gates Work on the top-level 'work' domain, independent of Personal Growth's subdomains", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "work", position: 0 }],
      subdomains: [],
    };
    const result = computeDomainVisibility(state);
    expect(result.hasWork).toBe(true);
    expect(result.hasFaith).toBe(false);
    expect(result.hasFitness).toBe(false);
    expect(result.hasSchoolDomain).toBe(false);
  });

  it("gates School on the top-level 'school' domain", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "school", position: 0 }],
      subdomains: [],
    };
    expect(computeDomainVisibility(state).hasSchoolDomain).toBe(true);
  });

  it("Self-Mastery being selected does not turn on any of these flags -- it has no old-domain equivalent, gated separately by the caller", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "personal_growth", position: 0 }],
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
    expect(computeDomainVisibility(state)).toEqual({
      hasFaith: false,
      hasFitness: false,
      hasWork: false,
      hasSchoolDomain: false,
    });
  });
});
