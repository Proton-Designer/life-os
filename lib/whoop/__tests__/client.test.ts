import { describe, it, expect, vi, beforeEach } from "vitest";

const safeFetchMock = vi.fn();
vi.mock("@/lib/net/safe-outbound-url", () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

vi.stubEnv("WHOOP_CLIENT_ID", "test-client-id");
vi.stubEnv("WHOOP_CLIENT_SECRET", "test-client-secret");

const { buildWhoopAuthorizeUrl, exchangeWhoopAuthorizationCode, refreshWhoopAccessToken } = await import("../client");

describe("buildWhoopAuthorizeUrl (P3-18)", () => {
  it("builds the real Whoop authorize URL with client_id/redirect_uri/scope/state", () => {
    const url = buildWhoopAuthorizeUrl("https://app.example.com/api/whoop/callback", "csrf-state-1");
    expect(url).toContain("https://api.prod.whoop.com/oauth/oauth2/auth?");
    expect(url).toContain("client_id=test-client-id");
    expect(url).toContain(encodeURIComponent("https://app.example.com/api/whoop/callback"));
    expect(url).toContain("state=csrf-state-1");
    expect(url).toContain("response_type=code");
    expect(url).toContain(encodeURIComponent("offline"));
  });
});

describe("exchangeWhoopAuthorizationCode (P3-18)", () => {
  beforeEach(() => safeFetchMock.mockReset());

  it("calls safeFetch (not raw fetch) against the token endpoint with the authorization_code grant", async () => {
    safeFetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: "at1", refresh_token: "rt1", expires_in: 3600, scope: "offline read:sleep" }), { status: 200 }));
    const res = await exchangeWhoopAuthorizationCode("auth-code-1", "https://app.example.com/api/whoop/callback");
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.data.accessToken).toBe("at1");
    expect(res.data.refreshToken).toBe("rt1");
    expect(res.data.scope).toBe("offline read:sleep");
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(safeFetchMock.mock.calls[0]![0]).toBe("https://api.prod.whoop.com/oauth/oauth2/token");
    const init = safeFetchMock.mock.calls[0]![1] as { method: string; body: string };
    expect(init.method).toBe("POST");
    expect(init.body).toContain("grant_type=authorization_code");
    expect(init.body).toContain("code=auth-code-1");
  });

  it("a 400/401 from Whoop is reported as a clear rejection, never the raw response body", async () => {
    safeFetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant", error_description: "super secret internal detail" }), { status: 400 }));
    const res = await exchangeWhoopAuthorizationCode("bad-code", "https://app.example.com/api/whoop/callback");
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected rejection");
    expect(res.message).not.toMatch(/secret internal detail/);
  });

  it("a malformed token response (missing access_token) is rejected, not silently accepted", async () => {
    safeFetchMock.mockResolvedValue(new Response(JSON.stringify({ scope: "offline" }), { status: 200 }));
    const res = await exchangeWhoopAuthorizationCode("code", "https://app.example.com/api/whoop/callback");
    expect(res.ok).toBe(false);
  });

  it("a thrown fetch error never leaks its raw message -- always a fixed, safe string", async () => {
    // mockImplementationOnce(() => Promise.reject(...)), not mockRejectedValue --
    // same established pattern lib/canvas/__tests__/client.test.ts already uses,
    // which avoids a documented vitest quirk where an eagerly-constructed
    // rejected Promise can report as an unhandled rejection before the
    // `await` below attaches its handler.
    safeFetchMock.mockImplementationOnce(() => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1:443 -- internal network detail")));
    const res = await exchangeWhoopAuthorizationCode("code", "https://app.example.com/api/whoop/callback");
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected rejection");
    expect(res.message).not.toMatch(/ECONNREFUSED|10\.0\.0\.1/);
  });
});

describe("refreshWhoopAccessToken (P3-18)", () => {
  it("uses the refresh_token grant against the same token endpoint", async () => {
    safeFetchMock.mockReset();
    safeFetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: "at2", refresh_token: "rt2", expires_in: 3600, scope: "offline" }), { status: 200 }));
    const res = await refreshWhoopAccessToken("old-refresh-token");
    expect(res.ok).toBe(true);
    const init = safeFetchMock.mock.calls[0]![1] as { body: string };
    expect(init.body).toContain("grant_type=refresh_token");
    expect(init.body).toContain("refresh_token=old-refresh-token");
  });
});
