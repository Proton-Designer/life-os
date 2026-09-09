import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimit, RATE_LIMIT_MAX_CALLS, RATE_LIMIT_WINDOW_SECONDS } from "../rate-limit";

function makeClient(resolved: { count: number | null; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte"]) chain[m] = vi.fn(() => chain);
  chain.then = (resolve: (v: typeof resolved) => void) => resolve(resolved);
  const from = vi.fn(() => chain);
  return { client: { from } as unknown as SupabaseClient, chain };
}

describe("checkRateLimit", () => {
  it("allows a token well under the limit", async () => {
    const { client } = makeClient({ count: 1, error: null });
    const result = await checkRateLimit(client, "tok-1");
    expect(result.ok).toBe(true);
  });

  it("allows a token exactly one call BELOW the limit", async () => {
    const { client } = makeClient({ count: RATE_LIMIT_MAX_CALLS - 1, error: null });
    const result = await checkRateLimit(client, "tok-1");
    expect(result.ok).toBe(true);
  });

  it("REJECTS a token exactly AT the limit", async () => {
    const { client } = makeClient({ count: RATE_LIMIT_MAX_CALLS, error: null });
    const result = await checkRateLimit(client, "tok-1");
    expect(result.ok).toBe(false);
  });

  it("REJECTS a token over the limit", async () => {
    const { client } = makeClient({ count: RATE_LIMIT_MAX_CALLS + 50, error: null });
    const result = await checkRateLimit(client, "tok-1");
    expect(result.ok).toBe(false);
  });

  it("fails CLOSED (rejects) when the count query itself errors, never treating a broken check as unlimited", async () => {
    const { client } = makeClient({ count: null, error: { message: "timeout" } });
    const result = await checkRateLimit(client, "tok-1");
    expect(result.ok).toBe(false);
  });

  it("scopes the query to the given token id and the trailing window, not to every row ever", async () => {
    const { client, chain } = makeClient({ count: 0, error: null });
    await checkRateLimit(client, "tok-xyz", 120, 10);
    expect(chain.eq).toHaveBeenCalledWith("token_id", "tok-xyz");
    expect(chain.gte).toHaveBeenCalledWith("created_at", expect.any(String));
  });

  it("a custom window/limit overrides the defaults", async () => {
    const { client } = makeClient({ count: 5, error: null });
    const tight = await checkRateLimit(client, "tok-1", RATE_LIMIT_WINDOW_SECONDS, 5);
    expect(tight.ok).toBe(false); // 5 >= limit of 5
    const loose = await checkRateLimit(client, "tok-1", RATE_LIMIT_WINDOW_SECONDS, 6);
    expect(loose.ok).toBe(true); // 5 < limit of 6
  });
});
