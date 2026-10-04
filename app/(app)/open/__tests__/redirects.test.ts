import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((_h: string) => {
  throw new Error("REDIRECT");
});
vi.mock("next/navigation", () => ({ redirect: (h: string) => redirectMock(h) }));

// IA-P2: Today moved onto Home; the old routes (bookmarks, links) land on Home.
describe("retired Today routes", () => {
  it.each([
    ["/open", () => import("../page")],
    ["/open/today", () => import("../today/page")],
    ["/close/replan", () => import("../../close/replan/page")],
  ])("%s redirects to /", async (_name, load) => {
    redirectMock.mockClear();
    const mod = await load();
    expect(() => mod.default()).toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });
  it("positive control: the mock records a different target when asked", () => {
    redirectMock.mockClear();
    expect(() => redirectMock("/elsewhere")).toThrow();
    expect(redirectMock).not.toHaveBeenCalledWith("/");
  });
});
