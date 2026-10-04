import { beforeEach, describe, expect, it, vi } from "vitest";

// next/navigation's redirect() throws; model that so code after it can't run.
class Redirected extends Error {
  constructor(public to: string) {
    super(`REDIRECT:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

let profile: { timezone: string } | null = { timezone: "America/Chicago" };
vi.mock("@/lib/supabase/auth", () => ({ getProfile: async () => profile }));

async function target(fn: () => unknown | Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
  throw new Error("did not redirect");
}

describe("retired screens redirect (nothing deleted, bookmarks survive)", () => {
  beforeEach(() => {
    profile = { timezone: "America/Chicago" };
    vi.useRealTimers();
  });

  it("/goals, /habits, /worries land on their /week step", async () => {
    expect(await target(async () => (await import("../../goals/page")).default())).toBe("/week#goals");
    expect(await target(async () => (await import("../../habits/page")).default())).toBe("/week#habits");
    expect(await target(async () => (await import("../../worries/page")).default())).toBe("/week#worries");
  });

  it("/weekly-review → the reset on Sunday, the Insights Week tab any other day, 'so far' always the tab", async () => {
    const page = (await import("../../weekly-review/page")).default;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T18:00:00Z")); // Sunday, Chicago
    expect(await target(() => page({ searchParams: Promise.resolve({}) }))).toBe("/week");
    expect(await target(() => page({ searchParams: Promise.resolve({ view: "so-far" }) }))).toBe("/insights?tab=week&view=so-far");
    vi.setSystemTime(new Date("2026-10-07T18:00:00Z")); // Wednesday
    expect(await target(() => page({ searchParams: Promise.resolve({}) }))).toBe("/insights?tab=week");
  });
});
