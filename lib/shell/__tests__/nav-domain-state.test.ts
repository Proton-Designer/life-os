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

/**
 * Migration 115's second regression, found on production AFTER the first
 * bridge shipped: personalSubdomains fed personal/[subdomain]/layout.tsx's
 * redirect guard, so an empty list bounced EVERY /personal/* route to "/".
 * The whole Self-Mastery section was unreachable — at HTTP 200, via redirect,
 * so nothing errored and no instrument could see it.
 *
 * The fixture that matters is `subdomains: []` — post-flatten getUserDomains
 * never fetches the archived group's children, so a fixture that keeps them
 * agrees with the bug instead of catching it.
 */
describe("computeNavDomainState — /personal routing survives migration 115", () => {
  const POST_115 = [
    { key: "faith" as const, position: 0 },
    { key: "body" as const, position: 1 },
    { key: "learning" as const, position: 2 },
    { key: "work" as const, position: 3 },
  ];

  it("personalSubdomains is non-empty after the flatten — an empty list bounces every /personal route", () => {
    const state = computeNavDomainState(POST_115, []);
    expect(state.personalSubdomains.length).toBe(3);
  });

  it("URL keys stay on the LEGACY route segments — the flatten renamed a domain, not a route", () => {
    const state = computeNavDomainState(POST_115, []);
    expect(state.personalSubdomains.map((s) => s.key)).toEqual(["faith", "fitness", "self_mastery"]);
  });

  it("orders synthesised areas by the top-level row's own position", () => {
    const reordered = [
      { key: "learning" as const, position: 0 },
      { key: "faith" as const, position: 5 },
    ];
    expect(computeNavDomainState(reordered, []).personalSubdomains.map((s) => s.key)).toEqual(["self_mastery", "faith"]);
  });

  it("an area the user does not track is not synthesised", () => {
    const onlyFaith = [{ key: "faith" as const, position: 0 }];
    expect(computeNavDomainState(onlyFaith, []).personalSubdomains.map((s) => s.key)).toEqual(["faith"]);
  });

  it("pre-115 real subdomain rows still win — labels and kinds come from the user's own data", () => {
    const pre = [{ key: "personal_growth" as const, position: 0 }];
    const subs = [
      { domainKey: "personal_growth" as const, key: "self_mastery", label: "My Practice", kind: null },
      { domainKey: "personal_growth" as const, key: "faith", label: "Deen", kind: null },
    ];
    const state = computeNavDomainState(pre, subs);
    expect(state.personalSubdomains.map((s) => s.label)).toEqual(["My Practice", "Deen"]);
  });
});
