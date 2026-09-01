import { describe, expect, it } from "vitest";
import { Briefcase, Moon } from "lucide-react";
import { DOMAIN_ICON, getDomainIcon } from "../domain-icons";

describe("getDomainIcon", () => {
  it("returns the exact real icon for each of the 5 fixed domains", () => {
    for (const key of Object.keys(DOMAIN_ICON) as (keyof typeof DOMAIN_ICON)[]) {
      expect(getDomainIcon(key)).toBe(DOMAIN_ICON[key]);
    }
    expect(getDomainIcon("deen")).toBe(Moon);
  });

  it("falls back to Briefcase for an arbitrary Work-subdomain key rather than returning undefined -- this is the crash IconChip's required `icon` prop would otherwise hit", () => {
    expect(getDomainIcon("acme-consulting")).toBe(Briefcase);
    expect(getDomainIcon("")).toBe(Briefcase);
  });
});
