import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const clientIpFromHeadersMock = vi.fn();
const hashRegistrationIpMock = vi.fn();
vi.mock("@/lib/mcp/oauth", () => ({
  clientIpFromHeaders: (h: Headers) => clientIpFromHeadersMock(h),
  hashRegistrationIp: (ip: string | null) => hashRegistrationIpMock(ip),
}));

import { checkPublicShareViewLimit, PUBLIC_SHARE_VIEW_LIMIT, PUBLIC_SHARE_VIEW_WINDOW_SECONDS } from "../public-share-rate-limit";

describe("checkPublicShareViewLimit", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clientIpFromHeadersMock.mockReturnValue("1.2.3.4");
    hashRegistrationIpMock.mockReturnValue("hashed-ip");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is generous: 300 requests per hour, not tens", () => {
    expect(PUBLIC_SHARE_VIEW_LIMIT).toBe(300);
    expect(PUBLIC_SHARE_VIEW_WINDOW_SECONDS).toBe(3600);
  });

  it("uses its OWN key namespace ('shareview:'), not auth-failure-limit's ('authfail:')", async () => {
    const rpc = vi.fn(async () => ({ data: { over_limit: false }, error: null }));
    const client = { rpc } as unknown as SupabaseClient;

    await checkPublicShareViewLimit(client, new Headers());

    expect(rpc).toHaveBeenCalledWith(
      "mcp_rate_limit_note_failure",
      expect.objectContaining({ p_key: "shareview:hashed-ip", p_limit: PUBLIC_SHARE_VIEW_LIMIT, p_window_seconds: PUBLIC_SHARE_VIEW_WINDOW_SECONDS })
    );
  });

  it("not limited under the cap", async () => {
    const client = { rpc: vi.fn(async () => ({ data: { over_limit: false }, error: null })) } as unknown as SupabaseClient;
    const result = await checkPublicShareViewLimit(client, new Headers());
    expect(result).toEqual({ limited: false });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("limited over the cap, and logs the throttle event server-side (ipHash only, never the raw IP)", async () => {
    const client = { rpc: vi.fn(async () => ({ data: { over_limit: true, retry_after_seconds: 42 }, error: null })) } as unknown as SupabaseClient;

    const result = await checkPublicShareViewLimit(client, new Headers());

    expect(result).toEqual({ limited: true, retryAfterSeconds: 42 });
    expect(warnSpy).toHaveBeenCalledWith("[share-view-rate-limit] throttled", { ipHash: "hashed-ip", retryAfterSeconds: 42 });
    const loggedArgs = warnSpy.mock.calls[0]!;
    expect(JSON.stringify(loggedArgs)).not.toContain("1.2.3.4"); // raw IP never logged
  });

  it("FAILS OPEN when there is no client IP -- never blocks a real visitor over its own inability to identify them", async () => {
    hashRegistrationIpMock.mockReturnValue(null);
    const client = { rpc: vi.fn() } as unknown as SupabaseClient;

    const result = await checkPublicShareViewLimit(client, new Headers());

    expect(result).toEqual({ limited: false });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("FAILS OPEN on an RPC error -- this limiter's own breakage must never fail a real visitor's link", async () => {
    const client = { rpc: vi.fn(async () => ({ data: null, error: new Error("db down") })) } as unknown as SupabaseClient;
    const result = await checkPublicShareViewLimit(client, new Headers());
    expect(result).toEqual({ limited: false });
  });
});
