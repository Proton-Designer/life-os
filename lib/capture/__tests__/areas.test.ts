import { describe, expect, it } from "vitest";
import { buildCaptureAreaConfig, captureAreaOptions, defaultCaptureArea, isCaptureArea } from "../areas";
import type { NavDomainState } from "@/lib/shell/nav-domain-state";

function nav(over: Partial<NavDomainState> = {}): NavDomainState {
  return { hasPersonalGrowth: false, hasWork: false, hasSchool: false, personalSubdomains: [], workSubdomains: [], ...over };
}
const values = (o: { value: string }[]) => o.map((x) => x.value);

describe("captureAreaOptions", () => {
  it("legacy = today's areas (School, Work) plus the Inbox", () => {
    expect(values(captureAreaOptions("legacy", null))).toEqual(["school", "co_op", "none"]);
  });

  it("domains mode offers only the areas the account turned on", () => {
    expect(values(captureAreaOptions("domains", nav({ hasSchool: true })))).toEqual(["school", "none"]);
    expect(values(captureAreaOptions("domains", nav({ hasWork: true })))).toEqual(["co_op", "none"]);
    expect(values(captureAreaOptions("domains", nav()))).toEqual(["none"]);
  });

  it("an account whose Work tabs are all Business tabs has no task home in Work", () => {
    const n = nav({ hasWork: true, workSubdomains: [{ key: "shop", label: "Shop", kind: "business" }] });
    expect(values(captureAreaOptions("domains", n))).toEqual(["none"]);
    const withJob = nav({ hasWork: true, workSubdomains: [{ key: "shop", label: "Shop", kind: "business" }, { key: "job", label: "Job", kind: "job" }] });
    expect(values(captureAreaOptions("domains", withJob))).toEqual(["co_op", "none"]);
  });

  it("no input ever yields a faith/Faith area — tasks have no such home, so Faith OFF cannot leak one", () => {
    for (const o of [...captureAreaOptions("legacy", null), ...captureAreaOptions("domains", nav({ hasPersonalGrowth: true, hasWork: true, hasSchool: true, personalSubdomains: [{ key: "faith", label: "Faith", kind: null }] }))]) {
      expect(o.label.toLowerCase()).not.toMatch(/faith|deen/);
    }
  });

  it("isCaptureArea accepts exactly the four values", () => {
    expect(["school", "co_op", "business", "none"].every(isCaptureArea)).toBe(true);
    for (const bad of ["faith", "", undefined, null, 1]) expect(isCaptureArea(bad)).toBe(false);
  });
});

describe("defaultCaptureArea", () => {
  const n = nav({
    hasSchool: true,
    hasWork: true,
    workSubdomains: [
      { key: "job", label: "Job", kind: "job" },
      { key: "my shop", label: "Shop", kind: "business" },
    ],
  });
  const cfg = buildCaptureAreaConfig("domains", n);

  it.each([
    ["/school", "school"],
    ["/school/classes", "school"],
    ["/work/job", "co_op"],
    ["/work", "co_op"],
    ["/work/my%20shop", "business"], // a Business tab (URL-encoded key): its home is the Kill List
    ["/business", "business"],
    ["/", "none"],
    ["/fitness", "none"],
    ["/personal/faith", "none"],
  ])("%s → %s", (route, want) => {
    expect(defaultCaptureArea(route, cfg)).toBe(want);
  });

  it("falls back to the Inbox when the route's area isn't one the account has", () => {
    const only = buildCaptureAreaConfig("domains", nav({ hasSchool: true }));
    expect(defaultCaptureArea("/work/job", only)).toBe("none");
  });

  it("a malformed % escape in the path does not throw", () => {
    expect(defaultCaptureArea("/work/%E0%A4%A", cfg)).toBe("co_op");
  });
});

describe("buildCaptureAreaConfig offers Business only with a Kill List", () => {
  it("legacy accounts and accounts with a Business Work tab get it, just before 'No area'", () => {
    expect(values(buildCaptureAreaConfig("legacy", null).options)).toEqual(["school", "co_op", "business", "none"]);
    const withShop = nav({ hasSchool: true, hasWork: true, workSubdomains: [{ key: "shop", label: "Shop", kind: "business" }] });
    expect(values(buildCaptureAreaConfig("domains", withShop).options)).toEqual(["school", "business", "none"]);
  });
  it("an account with no Business tab is not offered it (positive control: captureAreaOptions never lists it)", () => {
    expect(values(buildCaptureAreaConfig("domains", nav({ hasSchool: true })).options)).toEqual(["school", "none"]);
    expect(values(captureAreaOptions("legacy", null))).not.toContain("business");
  });
});
