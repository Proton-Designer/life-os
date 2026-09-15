import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => "service-client-marker") }));

const consumeAuthorizationCode = vi.fn();
const mintRefreshToken = vi.fn();
const findAccessTokenForRefreshToken = vi.fn();
const getOAuthClient = vi.fn();
const runRefreshGrant = vi.fn();
vi.mock("@/lib/mcp/oauth", async (importActual) => {
  // formatOAuthTokenLabel is kept REAL (importActual), not mocked — it's a
  // pure function, and mocking it would make these tests assert against a
  // fake label shape instead of the real one that shipped the bug.
  const actual = await importActual<typeof import("@/lib/mcp/oauth")>();
  return {
    ...actual,
    consumeAuthorizationCode: (...args: unknown[]) => consumeAuthorizationCode(...args),
    mintRefreshToken: (...args: unknown[]) => mintRefreshToken(...args),
    findAccessTokenForRefreshToken: (...args: unknown[]) => findAccessTokenForRefreshToken(...args),
    getOAuthClient: (...args: unknown[]) => getOAuthClient(...args),
    runRefreshGrant: (...args: unknown[]) => runRefreshGrant(...args),
  };
});

const createAccessToken = vi.fn();
vi.mock("@/lib/mcp/tokens", async (importActual) => ({
  // Real constants (OAUTH_ACCESS_TOKEN_TTL_SECONDS), so expires_in is asserted against the shipped value, not a mock's.
  ...(await importActual<typeof import("@/lib/mcp/tokens")>()),
  createAccessToken: (...args: unknown[]) => createAccessToken(...args),
}));

import { POST } from "../route";

function formRequest(fields: Record<string, string>) {
  return new Request("https://lifeos.example.com/api/mcp/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

beforeEach(() => {
  consumeAuthorizationCode.mockReset();
  mintRefreshToken.mockReset();
  findAccessTokenForRefreshToken.mockReset();
  getOAuthClient.mockReset();
  getOAuthClient.mockResolvedValue(null); // default: unnamed client, unless a test overrides it
  createAccessToken.mockReset();
  runRefreshGrant.mockReset();
});

describe("POST /api/mcp/oauth/token", () => {
  it("rejects an unknown/missing grant_type", async () => {
    const response = await POST(formRequest({ grant_type: "client_credentials" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("unsupported_grant_type");
  });

  describe("grant_type=authorization_code", () => {
    it("rejects a request missing any required field", async () => {
      const response = await POST(formRequest({ grant_type: "authorization_code", code: "x" }));
      expect(response.status).toBe(400);
      expect(consumeAuthorizationCode).not.toHaveBeenCalled();
    });

    it("surfaces consumeAuthorizationCode's own error rather than proceeding", async () => {
      consumeAuthorizationCode.mockResolvedValueOnce({ ok: false, error: "invalid_grant", message: "expired" });
      const response = await POST(
        formRequest({ grant_type: "authorization_code", code: "c", redirect_uri: "https://a.example.com/cb", client_id: "cid", code_verifier: "v" })
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_grant");
      expect(createAccessToken).not.toHaveBeenCalled();
    });

    it("on success: mints an access token AND a refresh token (P4-12: a 30-day mcp_oauth token, reported as expires_in)", async () => {
      consumeAuthorizationCode.mockResolvedValueOnce({ ok: true, userId: "user-1", scopes: ["read", "write"], resource: null });
      createAccessToken.mockResolvedValueOnce({ ok: true, token: "lifeos_pat_new", status: { id: "tok-1", scopes: ["read", "write"] } });
      mintRefreshToken.mockResolvedValueOnce({ ok: true, refreshToken: "lifeos_oauthrefresh_new" });

      const response = await POST(
        formRequest({ grant_type: "authorization_code", code: "c", redirect_uri: "https://a.example.com/cb", client_id: "cid", code_verifier: "v" })
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.access_token).toBe("lifeos_pat_new");
      expect(body.token_type).toBe("Bearer");
      expect(body.refresh_token).toBe("lifeos_oauthrefresh_new");
      expect(body.scope).toBe("read write");
      expect(body.expires_in).toBe(30 * 24 * 60 * 60);
      // No client_name on record (default mock) -> the honest fallback label, never the raw client_id.
      expect(createAccessToken).toHaveBeenCalledWith("service-client-marker", "user-1", "OAuth: unnamed connector", ["read", "write"], {
        clientKind: "mcp_oauth",
        expiresAt: expect.any(String),
      });
      const { expiresAt } = createAccessToken.mock.calls[0][4] as { expiresAt: string };
      const msFromNow = Date.parse(expiresAt) - Date.now();
      expect(msFromNow).toBeGreaterThan(30 * 86_400_000 - 60_000);
      expect(msFromNow).toBeLessThanOrEqual(30 * 86_400_000);
    });

    it("labels the minted token with the client's registered name, never the raw client_id — the actual /settings overflow + unreadable-label bug", async () => {
      consumeAuthorizationCode.mockResolvedValueOnce({ ok: true, userId: "user-1", scopes: ["read"], resource: null });
      getOAuthClient.mockResolvedValueOnce({ client_id: "lifeos_client_Oqnz20Fqx4YJ2WbhzSFCROot", client_name: "Claude", redirect_uris: [], created_at: "2026-09-09T00:00:00Z" });
      createAccessToken.mockResolvedValueOnce({ ok: true, token: "lifeos_pat_new", status: { id: "tok-1", scopes: ["read"] } });
      mintRefreshToken.mockResolvedValueOnce({ ok: true, refreshToken: "lifeos_oauthrefresh_new" });

      await POST(
        formRequest({ grant_type: "authorization_code", code: "c", redirect_uri: "https://a.example.com/cb", client_id: "lifeos_client_Oqnz20Fqx4YJ2WbhzSFCROot", code_verifier: "v" })
      );

      const label = createAccessToken.mock.calls[0][2] as string;
      expect(label).toBe("OAuth: Claude");
      expect(label).not.toContain("lifeos_client_");
    });
  });

  describe("grant_type=refresh_token (P4-13: one serialized grant, migration 217)", () => {
    const FOUND = { accessTokenId: "tok-old", userId: "user-1", clientId: "cid" };

    it("rejects a missing refresh_token", async () => {
      const response = await POST(formRequest({ grant_type: "refresh_token" }));
      expect(response.status).toBe(400);
      expect(runRefreshGrant).not.toHaveBeenCalled();
    });

    it("an unknown refresh token is invalid_grant, and the grant never runs", async () => {
      findAccessTokenForRefreshToken.mockResolvedValueOnce(null);
      const response = await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt" }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_grant");
      expect(runRefreshGrant).not.toHaveBeenCalled();
    });

    it("runs the grant with the client's label and a 30-day expiry, and returns the new tokens with expires_in and the carried-forward scopes", async () => {
      findAccessTokenForRefreshToken.mockResolvedValueOnce(FOUND);
      getOAuthClient.mockResolvedValueOnce({ client_id: "cid", client_name: "Claude", redirect_uris: [], created_at: "x" });
      runRefreshGrant.mockResolvedValueOnce({ outcome: "ok", accessToken: "lifeos_pat_new", refreshToken: "lifeos_oauthrefresh_new", accessTokenId: "tok-new", scopes: ["read"] });

      const response = await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt-live" }));

      expect(getOAuthClient).toHaveBeenCalledWith("service-client-marker", "cid");
      const [client, raw, params] = runRefreshGrant.mock.calls[0] as [string, string, { label: string; expiresAt: string }];
      expect(client).toBe("service-client-marker");
      expect(raw).toBe("rt-live");
      expect(params.label).toBe("OAuth: Claude");
      const ms = Date.parse(params.expiresAt) - Date.now();
      expect(ms).toBeGreaterThan(30 * 86_400_000 - 60_000);
      expect(ms).toBeLessThanOrEqual(30 * 86_400_000);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ access_token: "lifeos_pat_new", token_type: "Bearer", expires_in: 30 * 24 * 60 * 60, scope: "read", refresh_token: "lifeos_oauthrefresh_new" });
    });

    it.each([
      ["reuse", /already been used/i],
      ["revoked", /revoked or no longer exists/i],
      ["invalid", /invalid/i],
    ] as const)("outcome %s -> 400 invalid_grant, no tokens in the response", async (outcome, message) => {
      findAccessTokenForRefreshToken.mockResolvedValueOnce(FOUND);
      runRefreshGrant.mockResolvedValueOnce({ outcome });
      const response = await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt" }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_grant");
      expect(body.error_description).toMatch(message);
      expect(body).not.toHaveProperty("access_token");
    });

    it("outcome error -> 500 with a GENERIC description (never DB text)", async () => {
      findAccessTokenForRefreshToken.mockResolvedValueOnce(FOUND);
      runRefreshGrant.mockResolvedValueOnce({ outcome: "error" });
      const response = await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt" }));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe("server_error");
      expect(body.error_description).toBe("The token request couldn't be completed. Try again.");
    });

    it("outcome cap -> 500 with the clear 'revoke a connection' message", async () => {
      findAccessTokenForRefreshToken.mockResolvedValueOnce(FOUND);
      runRefreshGrant.mockResolvedValueOnce({ outcome: "cap" });
      const response = await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt" }));
      expect(response.status).toBe(500);
      expect((await response.json()).error_description).toMatch(/Revoke one in Life OS Settings/);
    });

    it("never mints tokens itself on the refresh path (createAccessToken/mintRefreshToken are the authorization_code path only)", async () => {
      findAccessTokenForRefreshToken.mockResolvedValueOnce(FOUND);
      runRefreshGrant.mockResolvedValueOnce({ outcome: "ok", accessToken: "a", refreshToken: "r", accessTokenId: "t", scopes: ["read"] });
      await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt" }));
      expect(createAccessToken).not.toHaveBeenCalled();
      expect(mintRefreshToken).not.toHaveBeenCalled();
    });
  });
});
