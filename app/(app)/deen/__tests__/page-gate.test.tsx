import { beforeEach, describe, expect, it, vi } from "vitest";

// D3: /deen (and /personal/faith, which composes DeenPage) redirects to "/"
// when Deen Mode is off -- before any deen query runs.
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
const fromMock = vi.fn(() => {
  throw new Error("DB touched");
});
let profile: Record<string, unknown> | null = null;

vi.mock("next/navigation", () => ({ redirect: redirectMock, notFound: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: fromMock })) }));
vi.mock("@/lib/supabase/auth", () => ({
  getAuthedUser: vi.fn(async () => ({ id: "user-1" })),
  getProfile: vi.fn(async () => profile),
  requireUser: vi.fn(),
}));

describe("DeenPage Faith Mode gate", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    fromMock.mockClear();
  });

  for (const [label, p] of [
    ["deen_mode false", { timezone: "UTC", deen_mode: false }],
    ["deen_mode null", { timezone: "UTC", deen_mode: null }],
    ["no profile row", null],
  ] as const) {
    it(`redirects to / with ${label} and runs no deen query`, async () => {
      profile = p as Record<string, unknown> | null;
      const { default: DeenPage } = await import("../page");
      await expect(DeenPage()).rejects.toThrow("NEXT_REDIRECT:/");
      expect(redirectMock).toHaveBeenCalledWith("/");
      expect(fromMock).not.toHaveBeenCalled();
    });
  }

  it("positive control: ON passes the gate and proceeds to its queries", async () => {
    profile = { timezone: "UTC", deen_mode: true };
    const { default: DeenPage } = await import("../page");
    await expect(DeenPage()).rejects.toThrow("DB touched");
    expect(redirectMock).not.toHaveBeenCalledWith("/");
  });
});
