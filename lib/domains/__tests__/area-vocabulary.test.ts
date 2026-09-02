import { describe, expect, it } from "vitest";
import { areaWeight, hasArea } from "../area-vocabulary";
import type { UserDomainsState, UserSubdomainRow } from "../get-user-domains";
import { computeDomainVisibility } from "@/lib/home/compute-domain-visibility";

const sub = (domainKey: string, key: string, position: number): UserSubdomainRow => ({
  domainKey: domainKey as UserSubdomainRow["domainKey"],
  key,
  label: key,
  kind: null,
  widgets: [],
  config: {},
  position,
});

/** Pre-115: one personal_growth group row, three children under it. */
const PRE_115: UserDomainsState = {
  mode: "domains",
  domains: [
    { key: "personal_growth", position: 0, weight: "essential" },
    { key: "work", position: 1, weight: "important" },
  ],
  subdomains: [sub("personal_growth", "faith", 0), sub("personal_growth", "fitness", 1), sub("personal_growth", "self_mastery", 2)],
};

/**
 * Post-115, as getUserDomains ACTUALLY returns it. The critical detail is the
 * empty subdomains array: the group row is archived, so its id is absent from
 * the `.in("domain_id", ...)` list and its children are never queried at all.
 * Fixtures that keep the subdomains around would agree with the bug.
 */
const POST_115: UserDomainsState = {
  mode: "domains",
  domains: [
    { key: "faith", position: 0, weight: "essential" },
    { key: "body", position: 1, weight: "background" },
    { key: "learning", position: 2, weight: "important" },
    { key: "work", position: 3, weight: "important" },
  ],
  subdomains: [],
};

describe("area vocabulary bridge — the same user, either side of migration 115", () => {
  it("every area is present before the flatten", () => {
    expect(hasArea(PRE_115, "faith")).toBe(true);
    expect(hasArea(PRE_115, "body")).toBe(true);
    expect(hasArea(PRE_115, "learning")).toBe(true);
  });

  // Fails on pre-bridge code: reading `personal_growth:faith` finds nothing,
  // because the archived group row's children are never fetched.
  it("every area is STILL present after the flatten", () => {
    expect(hasArea(POST_115, "faith")).toBe(true);
    expect(hasArea(POST_115, "body")).toBe(true);
    expect(hasArea(POST_115, "learning")).toBe(true);
  });

  it("deselection survives the bridge — an area in neither vocabulary is absent", () => {
    const dropped: UserDomainsState = { mode: "domains", domains: [{ key: "work", position: 0, weight: "essential" }], subdomains: [] };
    expect(hasArea(dropped, "faith")).toBe(false);
    expect(hasArea(dropped, "body")).toBe(false);
  });

  it("a user who kept Personal Growth but dropped Fitness still has no Body area", () => {
    const noFitness: UserDomainsState = {
      ...PRE_115,
      subdomains: [sub("personal_growth", "faith", 0)],
    };
    expect(hasArea(noFitness, "faith")).toBe(true);
    expect(hasArea(noFitness, "body")).toBe(false);
  });

  it("legacy mode has no areas of its own — visibility handles that separately", () => {
    expect(hasArea({ mode: "legacy" }, "faith")).toBe(false);
  });
});

describe("areaWeight — inherited before the flatten, owned after", () => {
  it("pre-115 all three inherit the group's single tier", () => {
    expect(areaWeight(PRE_115, "faith")?.weightTier).toBe("essential");
    expect(areaWeight(PRE_115, "body")?.weightTier).toBe("essential");
    expect(areaWeight(PRE_115, "learning")?.weightTier).toBe("essential");
  });

  // The point of the flatten: weight stops being shared by three areas that
  // merely happened to sit under one group.
  it("post-115 each carries its own tier", () => {
    expect(areaWeight(POST_115, "faith")?.weightTier).toBe("essential");
    expect(areaWeight(POST_115, "body")?.weightTier).toBe("background");
    expect(areaWeight(POST_115, "learning")?.weightTier).toBe("important");
  });

  it("an untracked area is null, never a defaulted tier", () => {
    expect(areaWeight({ mode: "domains", domains: [], subdomains: [] }, "faith")).toBeNull();
  });
});

/**
 * The regression this whole pass exists to prevent, asserted at the surface
 * the user actually sees. On pre-bridge code both of these are FALSE after the
 * flatten, and Faith and Fitness disappear from Home for every domains-mode
 * user — with every row count still correct, so no migration gate can see it.
 */
describe("Home visibility survives the flatten", () => {
  it("Faith and Fitness sectors stay visible after 115", () => {
    const v = computeDomainVisibility(POST_115);
    expect(v.hasFaith).toBe(true);
    expect(v.hasFitness).toBe(true);
  });

  it("and are unchanged before it", () => {
    const v = computeDomainVisibility(PRE_115);
    expect(v.hasFaith).toBe(true);
    expect(v.hasFitness).toBe(true);
  });

  it("a legacy account is untouched by any of this (M6)", () => {
    const v = computeDomainVisibility({ mode: "legacy" });
    expect(v.hasFaith).toBe(true);
    expect(v.hasFitness).toBe(true);
  });
});
