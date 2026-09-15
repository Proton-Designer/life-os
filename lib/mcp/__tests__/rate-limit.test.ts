import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  consumeRateLimit,
  rateLimitBuckets,
  RATE_LIMIT_MAX_CALLS,
  RATE_LIMIT_USER_MAX_CALLS,
  RATE_LIMIT_WINDOW_SECONDS,
} from "../rate-limit";

/**
 * P4-14: the limiter is one atomic RPC (public.mcp_rate_limit_consume,
 * migration 220). These tests pin what the app sends and how it reads the
 * answer. The atomicity itself (40 parallel calls -> exactly 30, denials
 * don't consume, per-user ceiling across tokens) was proven against a real
 * Postgres with a lock-less control -- see the P4-14 task Log.
 */

function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("rateLimitBuckets", () => {
  it("interactive calls (MCP and REST) consume a per-token AND a per-user bucket", () => {
    expect(rateLimitBuckets("interactive", "tok-1", "user-1")).toEqual({
      keys: ["tok:tok-1", "user:user-1"],
      limits: [RATE_LIMIT_MAX_CALLS, RATE_LIMIT_USER_MAX_CALLS],
    });
  });

  it("scheduled fires use their own buckets, so a busy interactive session can't starve them", () => {
    const sched = rateLimitBuckets("scheduler", "tok-1", "user-1");
    expect(sched.keys).toEqual(["sched-tok:tok-1", "sched-user:user-1"]);
    expect(sched.keys.some((k) => rateLimitBuckets("interactive", "tok-1", "user-1").keys.includes(k))).toBe(false);
  });

  it("the per-user ceiling is above the per-token limit (one token alone never hits it first)", () => {
    expect(RATE_LIMIT_USER_MAX_CALLS).toBeGreaterThan(RATE_LIMIT_MAX_CALLS);
  });
});

describe("consumeRateLimit", () => {
  it("calls mcp_rate_limit_consume with the lane's keys, limits and window", async () => {
    const { client, rpc } = rpcClient({ data: { allowed: true }, error: null });
    const res = await consumeRateLimit(client, { tokenId: "tok-1", userId: "user-1", lane: "interactive" });
    expect(res).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("mcp_rate_limit_consume", {
      p_keys: ["tok:tok-1", "user:user-1"],
      p_limits: [RATE_LIMIT_MAX_CALLS, RATE_LIMIT_USER_MAX_CALLS],
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    });
  });

  it("a per-token denial reports the token limit and the RPC's retry-after", async () => {
    const { client } = rpcClient({ data: { allowed: false, limited_key: "tok:tok-1", retry_after_seconds: 42 }, error: null });
    const res = await consumeRateLimit(client, { tokenId: "tok-1", userId: "user-1", lane: "interactive" });
    expect(res.ok).toBe(false);
    expect(res.retryAfterSeconds).toBe(42);
    expect(res.message).toMatch(new RegExp(`${RATE_LIMIT_MAX_CALLS} calls per ${RATE_LIMIT_WINDOW_SECONDS}s per token`));
    expect(res.message).toMatch(/retry after 42s/i);
  });

  it("a per-user denial says it is the account-wide ceiling (all tokens)", async () => {
    const { client } = rpcClient({ data: { allowed: false, limited_key: "user:user-1", retry_after_seconds: 7 }, error: null });
    const res = await consumeRateLimit(client, { tokenId: "tok-2", userId: "user-1", lane: "interactive" });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(new RegExp(`${RATE_LIMIT_USER_MAX_CALLS} calls per ${RATE_LIMIT_WINDOW_SECONDS}s across all of this account's tokens`));
  });

  it("fails CLOSED when the RPC errors or answers nonsense -- a broken limiter never means unlimited", async () => {
    for (const result of [{ data: null, error: { message: "timeout" } }, { data: { what: 1 }, error: null }, { data: null, error: null }]) {
      const { client } = rpcClient(result);
      const res = await consumeRateLimit(client, { tokenId: "tok-1", userId: "user-1", lane: "interactive" });
      expect(res.ok, JSON.stringify(result)).toBe(false);
      expect(res.retryAfterSeconds).toBeGreaterThan(0);
    }
  });
});
