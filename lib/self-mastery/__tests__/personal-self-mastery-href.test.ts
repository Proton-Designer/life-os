import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserDomainsMock = vi.fn();
vi.mock("@/lib/domains/get-user-domains", () => ({ getUserDomains: () => getUserDomainsMock() }));
const deenModeMock = vi.fn(async () => false);
vi.mock("@/lib/deen/deen-mode-guard", () => ({ isDeenModeOnForRequest: () => deenModeMock() }));
const computeMock = vi.fn();
vi.mock("@/lib/shell/nav-domain-state", () => ({
  computeNavDomainState: (...args: unknown[]) => computeMock(...args),
}));

const { personalSelfMasteryHref } = await import("../personal-self-mastery-href");

beforeEach(() => {
  getUserDomainsMock.mockReset();
  computeMock.mockReset();
});

describe("personalSelfMasteryHref", () => {
  it("sends a domains-mode account that kept Self-Mastery to the tabbed /personal route", async () => {
    getUserDomainsMock.mockResolvedValue({ mode: "domains", domains: [], subdomains: [] });
    computeMock.mockReturnValue({ personalSubdomains: [{ key: "faith" }, { key: "self_mastery" }, { key: "fitness" }] });
    expect(await personalSelfMasteryHref()).toBe("/personal/self_mastery");
    expect(await personalSelfMasteryHref("b1")).toBe("/personal/self_mastery/b1");
  });

  it("keeps a legacy account on the standalone route (it has no /personal/*)", async () => {
    getUserDomainsMock.mockResolvedValue({ mode: "legacy" });
    expect(await personalSelfMasteryHref()).toBeNull();
  });

  it("keeps a domains-mode account that did not keep Self-Mastery on the standalone route", async () => {
    getUserDomainsMock.mockResolvedValue({ mode: "domains", domains: [], subdomains: [] });
    computeMock.mockReturnValue({ personalSubdomains: [{ key: "fitness" }] });
    expect(await personalSelfMasteryHref()).toBeNull();
  });
});
