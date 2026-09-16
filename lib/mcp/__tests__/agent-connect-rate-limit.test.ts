import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const clientIpFromHeadersMock = vi.fn();
const hashRegistrationIpMock = vi.fn();
vi.mock("@/lib/mcp/oauth", () => ({
  clientIpFromHeaders: (h: Headers) => clientIpFromHeadersMock(h),
  hashRegistrationIp: (ip: string | null) => hashRegistrationIpMock(ip),
}));

import { checkAgentConnectLimit, AGENT_CONNECT_LIMIT, AGENT_CONNECT_WINDOW_SECONDS } from "../agent-connect-rate-limit";

describe("checkAgentConnectLimit", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clientIpFromHeadersMock.mockReturnValue("1.2.3.4");
    hashRegistrationIpMock.mockReturnValue("hashed-ip");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is tighter than the public share-view limit: 20 per hour, since a hit here mints a real credential", () => {
    expect(AGENT_CONNECT_LIMIT).toBe(20);
    expect(AGENT_CONNECT_WINDOW_SECONDS).toBe(3600);
  });

  it("uses its OWN key namespace ('connect:'), not shareview's or authfail's", async () => {
    const rpc = vi.fn(async () => ({ data: { over_limit: false }, error: null }));
    const client = { rpc } as unknown as SupabaseClient;

    await checkAgentConnectLimit(client, new Headers());

    expect(rpc).toHaveBeenCalledWith(
      "mcp_rate_limit_note_failure",
      expect.objectContaining({ p_key: "connect:hashed-ip", p_limit: AGENT_CONNECT_LIMIT, p_window_seconds: AGENT_CONNECT_WINDOW_SECONDS })
    );
  });

  it("not limited under the cap", async () => {
    const client = { rpc: vi.fn(async () => ({ data: { over_limit: false }, error: null })) } as unknown as SupabaseClient;
    const result = await checkAgentConnectLimit(client, new Headers());
    expect(result).toEqual({ limited: false });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("limited over the cap, and logs the throttle event server-side (ipHash only, never the raw IP)", async () => {
    const client = { rpc: vi.fn(async () => ({ data: { over_limit: true, retry_after_seconds: 42 }, error: null })) } as unknown as SupabaseClient;

    const result = await checkAgentConnectLimit(client, new Headers());

    expect(result).toEqual({ limited: true, retryAfterSeconds: 42 });
    expect(warnSpy).toHaveBeenCalledWith("[agent-connect-rate-limit] throttled", { ipHash: "hashed-ip", retryAfterSeconds: 42 });
    const loggedArgs = warnSpy.mock.calls[0]!;
    expect(JSON.stringify(loggedArgs)).not.toContain("1.2.3.4"); // raw IP never logged
  });

  it("FAILS OPEN when there is no client IP -- never blocks a real agent over its own inability to identify a network", async () => {
    hashRegistrationIpMock.mockReturnValue(null);
    const client = { rpc: vi.fn() } as unknown as SupabaseClient;

    const result = await checkAgentConnectLimit(client, new Headers());

    expect(result).toEqual({ limited: false });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("FAILS OPEN on an RPC error -- this limiter's own breakage must never block a real connect attempt", async () => {
    const client = { rpc: vi.fn(async () => ({ data: null, error: new Error("db down") })) } as unknown as SupabaseClient;
    const result = await checkAgentConnectLimit(client, new Headers());
    expect(result).toEqual({ limited: false });
  });
});
