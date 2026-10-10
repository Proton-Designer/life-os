import { describe, expect, it } from "vitest";
import type { UserDomainsState } from "@/lib/domains/get-user-domains";
import { buildSectorRows, showBusinessWeeklyGoal, wantedSnapshots } from "../sector-rows";

type Dom = "faith" | "body" | "learning" | "work" | "school" | "personal_growth";
const state = (
  keys: Dom[],
  tabs: { key: string; label: string; kind: "job" | "business" | null }[] = []
): UserDomainsState => ({
  mode: "domains",
  domains: keys.map((key, position) => ({ key, position, weight: "primary" }) as never),
  subdomains: tabs.map((t, position) => ({ domainKey: "work", widgets: [], config: {}, position, ...t }) as never),
});
const labels = (s: UserDomainsState, deen = true) => buildSectorRows(s, deen).map((r) => r.label);

describe("buildSectorRows", () => {
  it("LEGACY keeps today's five rows (Faith only with Faith Mode) -- positive control for the old fixed list", () => {
    expect(labels({ mode: "legacy" }, true)).toEqual(["Faith", "Business", "Fitness", "School", "Work"]);
    expect(labels({ mode: "legacy" }, false)).toEqual(["Business", "Fitness", "School", "Work"]);
  });

  it("the user's own account (faith, learning, body, work[co-op job + business tab], school, Faith on) shows the same five in the same order", () => {
    const s = state(["faith", "learning", "body", "work", "school"], [
      { key: "business", label: "Business", kind: "business" },
      { key: "co-op", label: "Co-op", kind: "job" },
    ]);
    expect(buildSectorRows(s, true).map((r) => [r.label, r.snapshot, r.href])).toEqual([
      ["Faith", "deen", "/deen"],
      ["Business", "business", "/work/business"],
      ["Fitness", "fitness", "/fitness"],
      ["School", "school", "/school"],
      ["Co-op", "co_op", "/work/co-op"],
    ]);
  });

  it("a renamed Business tab shows its own label", () => {
    const s = state(["work"], [{ key: "business", label: "Acme Startup", kind: "business" }]);
    expect(labels(s)).toEqual(["Acme Startup"]);
  });

  it("an account with only some areas gets only those rows (0 / 1 / 2 areas)", () => {
    expect(labels(state([]))).toEqual([]);
    expect(labels(state(["body"]))).toEqual(["Fitness"]);
    expect(labels(state(["school", "body"]))).toEqual(["Fitness", "School"]);
  });

  it("a job-only work domain has no Business row; work with no tabs yet is one plain Work row", () => {
    expect(labels(state(["work"], [{ key: "co-op", label: "Co-op", kind: "job" }]))).toEqual(["Co-op"]);
    expect(labels(state(["work"]))).toEqual(["Work"]);
  });

  it("Faith needs BOTH Faith Mode and a faith area", () => {
    expect(labels(state(["faith"]), true)).toEqual(["Faith"]);
    expect(labels(state(["faith"]), false)).toEqual([]);
    expect(labels(state(["body"]), true)).toEqual(["Fitness"]);
  });

  it("tabs of work are ignored when the work domain itself is not active; learning alone has no row", () => {
    expect(labels(state(["learning"], [{ key: "x", label: "X", kind: "job" }]))).toEqual([]);
  });

  it("two tabs of one kind both get a row with unique ids", () => {
    const rows = buildSectorRows(state(["work"], [
      { key: "a", label: "A", kind: "job" },
      { key: "b", label: "B", kind: "job" },
    ]), false);
    expect(rows.map((r) => r.id)).toEqual(["work:a", "work:b"]);
  });
});

describe("wantedSnapshots", () => {
  it("is true only for snapshots some row reads (so absent areas' queries are skipped)", () => {
    const rows = buildSectorRows(state(["body", "work"], [{ key: "co-op", label: "Co-op", kind: "job" }]), false);
    expect(wantedSnapshots(rows)).toEqual({ deen: false, business: false, fitness: true, school: false, co_op: true });
    expect(wantedSnapshots([])).toEqual({ deen: false, business: false, fitness: false, school: false, co_op: false });
  });
});

// SECTOR-01 review F1/F4.
describe("Business weekly-goal slot and tab hrefs", () => {
  it("F1: the Business weekly-goal slot follows the Work DOMAIN, not a business-kind tab", () => {
    const jobOnly = state(["work"], [{ key: "co-op", label: "Co-op", kind: "job" }]);
    // Positive control: the sector derivation (what the code used to read) is false here...
    expect(wantedSnapshots(buildSectorRows(jobOnly, true)).business).toBe(false);
    // ...but the goal slot must stay on, as before SECTOR-01.
    expect(showBusinessWeeklyGoal(jobOnly, true)).toBe(true);
    expect(showBusinessWeeklyGoal(state(["work"]), true)).toBe(true);
    expect(showBusinessWeeklyGoal(state(["school", "body"]), true)).toBe(false);
    expect(showBusinessWeeklyGoal({ mode: "legacy", domains: [], subdomains: [] } as never, true)).toBe(true);
  });

  it("F4: a tab key is URL-encoded in its row href", () => {
    const rows = buildSectorRows(state(["work"], [{ key: "my shop/2", label: "Shop", kind: "business" }]), false);
    expect(rows[0]!.href).toBe("/work/my%20shop%2F2");
  });
});
