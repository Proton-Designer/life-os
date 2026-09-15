import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/middleware", () => ({ updateSession: vi.fn() }));

/**
 * P4-17: /api/v1 is bearer-only, so the Supabase cookie-refresh proxy must not
 * run on it (it would pay a getClaims() call per agent request for nothing).
 * The matcher is a path regex; this compiles it the way it is written and
 * checks representative paths. Red first: /api/v1 matched before the change.
 */
async function matches(pathname: string) {
  const { config } = await import("../../proxy");
  return config.matcher.some((m) => new RegExp(`^${m}$`).test(pathname));
}

describe("proxy.ts matcher", () => {
  it("skips /api/v1 and everything under it", async () => {
    expect(await matches("/api/v1")).toBe(false);
    expect(await matches("/api/v1/me")).toBe(false);
    expect(await matches("/api/v1/deen/prayer/log")).toBe(false);
  });

  it("still runs on app pages, other API routes, and look-alike paths", async () => {
    expect(await matches("/dashboard")).toBe(true);
    expect(await matches("/api/mcp")).toBe(true);
    expect(await matches("/api/cron/ping")).toBe(true);
    expect(await matches("/api/v10")).toBe(true);
    expect(await matches("/settings/connectors")).toBe(true);
  });

  it("still skips static assets", async () => {
    expect(await matches("/_next/static/chunk.js")).toBe(false);
    expect(await matches("/logo.svg")).toBe(false);
  });
});
