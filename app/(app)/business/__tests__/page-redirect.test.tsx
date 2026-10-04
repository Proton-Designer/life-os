import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (h: string) => {
    redirectMock(h);
    throw new Error(`REDIRECT:${h}`);
  },
}));
vi.mock("@/components/business/business-page-content", () => ({ BusinessPageContent: () => null }));
let state: unknown;
vi.mock("@/lib/domains/get-user-domains", () => ({ getUserDomains: async () => state }));

import BusinessPage from "../page";

const domains = (mode: "legacy" | "domains", subs: { key: string; kind: "job" | "business" | null }[]) => ({
  mode,
  domains: [{ key: "work", position: 0 }],
  subdomains: subs.map((s) => ({ domainKey: "work", key: s.key, label: s.key, kind: s.kind })),
});

describe("/business", () => {
  beforeEach(() => redirectMock.mockClear());

  it("domains mode with a Business tab redirects to it", async () => {
    state = domains("domains", [{ key: "co-op", kind: "job" }, { key: "shop", kind: "business" }]);
    await expect(BusinessPage()).rejects.toThrow("REDIRECT:/work/shop");
  });

  it("domains mode without a Business tab keeps serving the page (positive control for the redirect above)", async () => {
    state = domains("domains", [{ key: "co-op", kind: "job" }]);
    const el = await BusinessPage();
    expect(redirectMock).not.toHaveBeenCalled();
    expect((el as { type: unknown }).type).toBeTypeOf("function");
  });

  it("legacy mode never redirects", async () => {
    state = domains("legacy", [{ key: "shop", kind: "business" }]);
    await BusinessPage();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
