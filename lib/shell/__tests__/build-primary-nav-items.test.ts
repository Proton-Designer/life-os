import { describe, it, expect } from "vitest";
import { buildPrimaryNavItems } from "../build-primary-nav-items";
import type { NavDomainState } from "../nav-domain-state";

const EMPTY: NavDomainState = {
  hasPersonalGrowth: false,
  hasWork: false,
  hasSchool: false,
  personalSubdomains: [],
  workSubdomains: [],
};

describe("buildPrimaryNavItems", () => {
  it("always includes Home, even with no domains selected", () => {
    const items = buildPrimaryNavItems(EMPTY);
    expect(items.map((i) => i.key)).toEqual(["home"]);
  });

  it("adds exactly the selected domains, never a fixed set of four", () => {
    const items = buildPrimaryNavItems({ ...EMPTY, hasSchool: true });
    expect(items.map((i) => i.key)).toEqual(["home", "school"]);
  });

  it("Work's href jumps to the first subdomain, but activeBase covers every subdomain", () => {
    const items = buildPrimaryNavItems({
      ...EMPTY,
      hasWork: true,
      workSubdomains: [
        { key: "acme_inc", label: "Acme Inc", kind: "business" },
        { key: "night_shift", label: "Night shift", kind: "job" },
      ],
    });
    const work = items.find((i) => i.key === "work");
    expect(work?.href).toBe("/work/acme_inc");
    expect(work?.activeBase).toBe("/work");
  });

  it("Work falls back to the bare route when it has no subdomains yet", () => {
    const items = buildPrimaryNavItems({ ...EMPTY, hasWork: true });
    expect(items.find((i) => i.key === "work")?.href).toBe("/work");
  });

  it("never grows past four regardless of subdomain count", () => {
    const items = buildPrimaryNavItems({
      hasPersonalGrowth: true,
      hasWork: true,
      hasSchool: true,
      personalSubdomains: [
        { key: "faith", label: "Faith", kind: null },
        { key: "fitness", label: "Fitness", kind: null },
      ],
      workSubdomains: Array.from({ length: 10 }, (_, i) => ({ key: `job_${i}`, label: `Job ${i}`, kind: "job" as const })),
    });
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.key)).toEqual(["home", "personal", "work", "school"]);
  });
});
