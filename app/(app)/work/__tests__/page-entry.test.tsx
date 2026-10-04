import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (h: string) => {
    redirectMock(h);
    throw new Error(`REDIRECT:${h}`);
  },
}));
vi.mock("../work-screen", () => ({ WorkScreen: function WorkScreen() { return null; } }));
vi.mock("@/components/shell/work-tabs-bar", () => ({ WorkTabsBar: function WorkTabsBar() { return null; } }));
let state: unknown;
vi.mock("@/lib/domains/get-user-domains", () => ({ getUserDomains: async () => state }));

import WorkPage from "../page";

const domains = (tabs: string[], withWork = true) => ({
  mode: "domains",
  domains: withWork ? [{ key: "work", position: 0 }] : [{ key: "school", position: 0 }],
  subdomains: tabs.map((key) => ({ domainKey: "work", key, label: key, kind: "job" })),
});
const childNames = async () => {
  const el = (await WorkPage()) as { props: { children: ({ type: { name: string } } | null)[] } };
  return el.props.children.map((c) => c?.type.name ?? null);
};

describe("/work (WORK-W1b)", () => {
  beforeEach(() => redirectMock.mockClear());

  it("domains mode with tabs redirects to the first tab (positive control for the zero-tab case)", async () => {
    state = domains(["co-op", "side"]);
    await expect(WorkPage()).rejects.toThrow("REDIRECT:/work/co-op");
  });
  it("domains mode with ZERO tabs serves the Work screen WITH the tab bar (so a first tab can be added)", async () => {
    state = domains([]);
    expect(await childNames()).toEqual(["WorkTabsBar", "WorkScreen"]);
    expect(redirectMock).not.toHaveBeenCalled();
  });
  it("domains mode with NO Work domain gets no bar (Add Business would throw); positive control = the zero-tab case above has one", async () => {
    state = domains([], false);
    expect(await childNames()).toEqual([null, "WorkScreen"]);
  });
  it("legacy mode serves the plain screen: no bar, no redirect", async () => {
    state = { mode: "legacy" };
    expect(await childNames()).toEqual([null, "WorkScreen"]);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
