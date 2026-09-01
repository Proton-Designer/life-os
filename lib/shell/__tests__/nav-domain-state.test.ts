import { describe, it, expect } from "vitest";
import { computeNavDomainState } from "../nav-domain-state";

describe("computeNavDomainState", () => {
  it("shows only the domains actually selected", () => {
    const state = computeNavDomainState([{ key: "school" }], []);
    expect(state.hasPersonalGrowth).toBe(false);
    expect(state.hasWork).toBe(false);
    expect(state.hasSchool).toBe(true);
  });

  it("returns only the kept Personal Growth subdomains, in order", () => {
    const state = computeNavDomainState(
      [{ key: "personal_growth" }],
      [
        { domainKey: "personal_growth", key: "faith", label: "Faith", kind: null },
        { domainKey: "personal_growth", key: "fitness", label: "Fitness", kind: null },
      ]
    );
    expect(state.personalSubdomains).toEqual([
      { key: "faith", label: "Faith", kind: null },
      { key: "fitness", label: "Fitness", kind: null },
    ]);
  });

  it("a user who kept only Fitness gets exactly one Personal subdomain", () => {
    const state = computeNavDomainState(
      [{ key: "personal_growth" }],
      [{ domainKey: "personal_growth", key: "fitness", label: "Fitness", kind: null }]
    );
    expect(state.personalSubdomains).toHaveLength(1);
    expect(state.personalSubdomains[0].key).toBe("fitness");
  });

  it("returns user-created Work subdomains with their job/business kind", () => {
    const state = computeNavDomainState(
      [{ key: "work" }],
      [
        { domainKey: "work", key: "acme_inc", label: "Acme Inc", kind: "business" },
        { domainKey: "work", key: "night_shift", label: "Night shift", kind: "job" },
      ]
    );
    expect(state.workSubdomains).toEqual([
      { key: "acme_inc", label: "Acme Inc", kind: "business" },
      { key: "night_shift", label: "Night shift", kind: "job" },
    ]);
  });

  it("returns empty/false for a user with no domains at all", () => {
    const state = computeNavDomainState([], []);
    expect(state).toEqual({
      hasPersonalGrowth: false,
      hasWork: false,
      hasSchool: false,
      personalSubdomains: [],
      workSubdomains: [],
    });
  });
});
