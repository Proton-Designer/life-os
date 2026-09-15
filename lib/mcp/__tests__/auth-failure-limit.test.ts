import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTH_FAILURE_LIMIT,
  AUTH_FAILURE_WINDOW_SECONDS,
  noteAuthFailure,
  tooManyAuthFailuresResponse,
  __resetAuthFailureCacheForTests,
} from "../auth-failure-limit";
import { hashRegistrationIp } from "../oauth";

/**
 * P4-14: failed authentications (a presented-but-rejected bearer token, an
 * invalid_grant) are counted per HMAC'd client IP; over the limit the route
 * answers 429 + Retry-After instead of the 401/400. Counting happens ONLY on
 * the failure path -- a good request never pays for it, and is never blocked
 * (many users can share one egress IP, e.g. a hosted assistant's backend).
 */

function request(ip: string | null) {
  return new Request("https://x.test/api/mcp", { headers: ip ? { "x-forwarded-for": ip } : {} });
}

function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (_n: string, _a: Record<string, unknown>) => result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

beforeEach(() => __resetAuthFailureCacheForTests());

describe("noteAuthFailure", () => {
  it("counts the failure against authfail:<hmac(ip)> with the limit and window, never the raw IP", async () => {
    const { client, rpc } = rpcClient({ data: { over_limit: false, retry_after_seconds: 30 }, error: null });
    const res = await noteAuthFailure(client, request("203.0.113.9"));
    expect(res).toEqual({ limited: false });
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("mcp_rate_limit_note_failure");
    expect(args).toEqual({ p_key: `authfail:${hashRegistrationIp("203.0.113.9")}`, p_limit: AUTH_FAILURE_LIMIT, p_window_seconds: AUTH_FAILURE_WINDOW_SECONDS });
    expect(JSON.stringify(args)).not.toContain("203.0.113.9");
  });

  it("over the limit -> limited with the RPC's retry-after", async () => {
    const { client } = rpcClient({ data: { over_limit: true, retry_after_seconds: 17 }, error: null });
    expect(await noteAuthFailure(client, request("203.0.113.9"))).toEqual({ limited: true, retryAfterSeconds: 17 });
  });

  it("once an IP is known over the limit, this instance answers from memory (no RPC) until the window passes", async () => {
    const first = rpcClient({ data: { over_limit: true, retry_after_seconds: 20 }, error: null });
    await noteAuthFailure(first.client, request("198.51.100.1"));
    const second = rpcClient({ data: { over_limit: false, retry_after_seconds: 20 }, error: null });
    const res = await noteAuthFailure(second.client, request("198.51.100.1"));
    expect(res.limited).toBe(true);
    expect(second.rpc).not.toHaveBeenCalled();
    // A different IP is unaffected.
    const other = await noteAuthFailure(second.client, request("198.51.100.2"));
    expect(other.limited).toBe(false);
  });

  it("fails OPEN (plain 401 stays a 401) when the RPC errors or there is no IP -- this limit must never lock out on its own breakage", async () => {
    expect(await noteAuthFailure(rpcClient({ data: null, error: { message: "boom" } }).client, request("203.0.113.9"))).toEqual({ limited: false });
    const noIp = rpcClient({ data: { over_limit: true, retry_after_seconds: 5 }, error: null });
    expect(await noteAuthFailure(noIp.client, request(null))).toEqual({ limited: false });
    expect(noIp.rpc).not.toHaveBeenCalled();
  });
});

describe("tooManyAuthFailuresResponse", () => {
  it("is a 429 with Retry-After and a JSON body", async () => {
    const res = tooManyAuthFailuresResponse(12);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    expect((await res.json()).error).toBe("rate_limited");
  });
});
