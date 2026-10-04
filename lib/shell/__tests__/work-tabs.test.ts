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
