import { describe, expect, it } from "vitest";
import { businessTabHref, firstBusinessTab } from "../work-tabs";

const job = { key: "co-op", label: "Co-op", kind: "job" as const };
const biz = { key: "shop", label: "Shop", kind: "business" as const };
const biz2 = { key: "other", label: "Other", kind: "business" as const };

describe("work tabs helpers", () => {
  it("finds the FIRST business tab in position order (positive control: present)", () => {
    expect(firstBusinessTab([job, biz, biz2])).toEqual(biz);
    expect(businessTabHref([job, biz, biz2])).toBe("/work/shop");
  });
  it("is null / no href with no business tab, an empty list, or untyped tabs", () => {
    expect(firstBusinessTab([job])).toBeNull();
    expect(businessTabHref([])).toBeNull();
    expect(businessTabHref([{ key: "x", label: "X", kind: null }])).toBeNull();
  });
});

describe("workEntryTarget (WORK-W1b)", () => {
  it("redirects to the first tab (encoded) only in domains mode with tabs", async () => {
    const { workEntryTarget } = await import("../work-tabs");
    expect(workEntryTarget("domains", [job, biz])).toEqual({ kind: "redirect", href: "/work/co-op" });
    expect(workEntryTarget("domains", [{ key: "a b", label: "A", kind: null }])).toEqual({ kind: "redirect", href: "/work/a%20b" });
    expect(workEntryTarget("domains", [])).toEqual({ kind: "screen-with-bar" });
    expect(workEntryTarget("legacy", [job])).toEqual({ kind: "screen" });
    expect(workEntryTarget("domains", [], false)).toEqual({ kind: "screen" });
  });
});
