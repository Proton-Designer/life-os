import { describe, expect, it } from "vitest";
import { DOMAIN_ACCENT, getDomainAccent } from "../accent-tokens";

describe("getDomainAccent", () => {
  it("returns the exact real accent for each of the 5 fixed domains", () => {
    for (const key of Object.keys(DOMAIN_ACCENT) as (keyof typeof DOMAIN_ACCENT)[]) {
      expect(getDomainAccent(key)).toBe(DOMAIN_ACCENT[key]);
    }
    expect(getDomainAccent("co_op")).toBe("coop");
  });

  it("falls back to \"coop\" (Work's own accent) for an arbitrary Work-subdomain key", () => {
    expect(getDomainAccent("acme-consulting")).toBe("coop");
    expect(getDomainAccent("")).toBe("coop");
  });
});
