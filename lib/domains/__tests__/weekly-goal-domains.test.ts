import { describe, expect, it } from "vitest";
import { weeklyGoalDomains } from "../weekly-goal-domains";
import type { UserDomainsState, UserSubdomainRow } from "../get-user-domains";

const sub = (domainKey: string, key: string, position: number): UserSubdomainRow => ({
  domainKey: domainKey as UserSubdomainRow["domainKey"],
  key,
  label: key,
  kind: null,
  widgets: [],
  config: {},
  position,
});

describe("weeklyGoalDomains", () => {
  it("M6: legacy mode always includes deen — Faith existed in the original app, unlike Self-Mastery", () => {
    expect(weeklyGoalDomains({ mode: "legacy" })).toEqual(["deen", "business"]);
  });

  it("business is always included, in every mode — not yet a selectable/deselectable area", () => {
    const noFaith: UserDomainsState = { mode: "domains", domains: [{ key: "work", position: 0, weight: "important" }], subdomains: [] };
    expect(weeklyGoalDomains(noFaith)).toEqual(["business"]);
  });

  it("pre-115: includes deen when Faith is an active personal_growth subdomain", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "personal_growth", position: 0, weight: "essential" }],
      subdomains: [sub("personal_growth", "faith", 0)],
    };
    expect(weeklyGoalDomains(state)).toEqual(["deen", "business"]);
  });

  it("pre-115: excludes deen when Faith was declined (only Fitness/Self-Mastery kept)", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "personal_growth", position: 0, weight: "essential" }],
      subdomains: [sub("personal_growth", "fitness", 0)],
    };
    expect(weeklyGoalDomains(state)).toEqual(["business"]);
  });

  it("post-115: includes deen when Faith is a real top-level row", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "faith", position: 0, weight: "essential" }],
      subdomains: [],
    };
    expect(weeklyGoalDomains(state)).toEqual(["deen", "business"]);
  });

  it("post-115: excludes deen when Faith is not a top-level row at all", () => {
    const state: UserDomainsState = {
      mode: "domains",
      domains: [{ key: "body", position: 0, weight: "important" }],
      subdomains: [],
    };
    expect(weeklyGoalDomains(state)).toEqual(["business"]);
  });
});
