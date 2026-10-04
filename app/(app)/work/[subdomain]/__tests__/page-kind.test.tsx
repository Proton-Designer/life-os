import { describe, expect, it, vi } from "vitest";

vi.mock("../../page", () => ({ default: function WorkPage() { return null; } }));
vi.mock("@/components/business/business-page-content", () => ({ BusinessPageContent: function BusinessPageContent() { return null; } }));
let state: unknown;
vi.mock("@/lib/domains/get-user-domains", () => ({ getUserDomains: async () => state }));

import WorkSubdomainPage from "../page";

const sub = (key: string, kind: "job" | "business" | null, domainKey = "work") => ({ domainKey, key, label: key, kind });
const render = async (key: string) =>
  ((await WorkSubdomainPage({ params: Promise.resolve({ subdomain: key }) })) as { type: { name: string } }).type.name;

describe("/work/[subdomain] picks the screen by tab kind", () => {
  it("business tab -> Business screen; job tab -> Work screen", async () => {
    state = { mode: "domains", subdomains: [sub("co-op", "job"), sub("shop", "business")] };
    expect(await render("shop")).toBe("BusinessPageContent");
    expect(await render("co-op")).toBe("WorkPage");
  });
  it("unknown key, untyped tab, a same-key non-work subdomain, and legacy mode fall back to the Work screen", async () => {
    state = { mode: "domains", subdomains: [sub("shop", "business", "personal_growth"), sub("x", null)] };
    expect(await render("shop")).toBe("WorkPage");
    expect(await render("x")).toBe("WorkPage");
    expect(await render("nope")).toBe("WorkPage");
    state = { mode: "legacy", subdomains: [] };
    expect(await render("shop")).toBe("WorkPage");
  });
});
