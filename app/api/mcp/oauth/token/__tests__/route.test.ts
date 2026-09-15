import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => "service-client-marker") }));

const consumeAuthorizationCode = vi.fn();
const rotateRefreshToken = vi.fn();
const mintRefreshToken = vi.fn();
const findAccessTokenForRefreshToken = vi.fn();
const findLiveAccessTokenIdsForClient = vi.fn();
const getOAuthClient = vi.fn();
const burnUnusedRefreshTokensForClient = vi.fn();
vi.mock("@/lib/mcp/oauth", async (importActual) => {
  // formatOAuthTokenLabel is kept REAL (importActual), not mocked — it's a
  // pure function, and mocking it would make these tests assert against a
  // fake label shape instead of the real one that shipped the bug.
  const actual = await importActual<typeof import("@/lib/mcp/oauth")>();
  return {
    ...actual,
    consumeAuthorizationCode: (...args: unknown[]) => consumeAuthorizationCode(...args),
    rotateRefreshToken: (...args: unknown[]) => rotateRefreshToken(...args),
    mintRefreshToken: (...args: unknown[]) => mintRefreshToken(...args),
    findAccessTokenForRefreshToken: (...args: unknown[]) => findAccessTokenForRefreshToken(...args),
    findLiveAccessTokenIdsForClient: (...args: unknown[]) => findLiveAccessTokenIdsForClient(...args),
    getOAuthClient: (...args: unknown[]) => getOAuthClient(...args),
    burnUnusedRefreshTokensForClient: (...args: unknown[]) => burnUnusedRefreshTokensForClient(...args),
  };
});

const createAccessToken = vi.fn();
const revokeAccessToken = vi.fn();
const getTokenScopesById = vi.fn();
vi.mock("@/lib/mcp/tokens", async (importActual) => ({
  // Real constants (OAUTH_ACCESS_TOKEN_TTL_SECONDS), so expires_in is asserted against the shipped value, not a mock's.
  ...(await importActual<typeof import("@/lib/mcp/tokens")>()),
  createAccessToken: (...args: unknown[]) => createAccessToken(...args),
  revokeAccessToken: (...args: unknown[]) => revokeAccessToken(...args),
  getTokenScopesById: (...args: unknown[]) => getTokenScopesById(...args),
}));

const repointScheduledActionsToken = vi.fn();
vi.mock("@/lib/scheduling/token-handoff", () => ({
  repointScheduledActionsToken: (...args: unknown[]) => repointScheduledActionsToken(...args),
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
  rotateRefreshToken.mockReset();
  mintRefreshToken.mockReset();
  findAccessTokenForRefreshToken.mockReset();
  findLiveAccessTokenIdsForClient.mockReset();
  getOAuthClient.mockReset();
  burnUnusedRefreshTokensForClient.mockReset();
  burnUnusedRefreshTokensForClient.mockResolvedValue(0);
  getOAuthClient.mockResolvedValue(null); // default: unnamed client, unless a test overrides it
  createAccessToken.mockReset();
  revokeAccessToken.mockReset();
  getTokenScopesById.mockReset();
  repointScheduledActionsToken.mockReset();
  repointScheduledActionsToken.mockResolvedValue(0);
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

  describe("grant_type=refresh_token", () => {
    it("rejects a missing refresh_token", async () => {
      const response = await POST(formRequest({ grant_type: "refresh_token" }));
      expect(response.status).toBe(400);
      expect(rotateRefreshToken).not.toHaveBeenCalled();
    });

    it("a plain invalid refresh token (no reuse) is rejected without touching revokeAccessToken", async () => {
      rotateRefreshToken.mockResolvedValueOnce({ ok: false, error: "invalid_grant", message: "invalid", reuseDetected: false });
      const response = await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt" }));
      expect(response.status).toBe(400);
      expect(revokeAccessToken).not.toHaveBeenCalled();
      expect(findAccessTokenForRefreshToken).not.toHaveBeenCalled();
      expect(findLiveAccessTokenIdsForClient).not.toHaveBeenCalled();
    });

    it("REUSE DETECTED (simple case, no race): revokes the stale row's own (already-dead) access token, then rejects", async () => {
      rotateRefreshToken.mockResolvedValueOnce({ ok: false, error: "invalid_grant", message: "reused", reuseDetected: true });
      findAccessTokenForRefreshToken.mockResolvedValueOnce({ accessTokenId: "tok-stale", userId: "user-1", clientId: "cid" });
      findLiveAccessTokenIdsForClient.mockResolvedValueOnce([]); // nothing else live

      const response = await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt-stolen" }));

      expect(revokeAccessToken).toHaveBeenCalledWith("service-client-marker", "user-1", "tok-stale");
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_grant");
    });

    it("REUSE DETECTED (the race that matters): ALSO revokes the currently-live access token, not just the stale row's own — this is the actual attacker-redeemed-first scenario", async () => {
      rotateRefreshToken.mockResolvedValueOnce({ ok: false, error: "invalid_grant", message: "reused", reuseDetected: true });
      findAccessTokenForRefreshToken.mockResolvedValueOnce({ accessTokenId: "tok-stale-already-dead", userId: "user-1", clientId: "cid" });
      // The attacker already redeemed this refresh token once and is holding a LIVE token from it.
      findLiveAccessTokenIdsForClient.mockResolvedValueOnce(["tok-attackers-live-token"]);

      await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt-stolen" }));

      expect(findLiveAccessTokenIdsForClient).toHaveBeenCalledWith("service-client-marker", "user-1", "cid");
      expect(revokeAccessToken).toHaveBeenCalledWith("service-client-marker", "user-1", "tok-stale-already-dead");
      expect(revokeAccessToken).toHaveBeenCalledWith("service-client-marker", "user-1", "tok-attackers-live-token");
    });

    it("P4-11 security: REUSE DETECTED also burns every unused refresh token for the (user, client) pair, after reading the live ids", async () => {
      rotateRefreshToken.mockResolvedValueOnce({ ok: false, error: "invalid_grant", message: "reused", reuseDetected: true });
      findAccessTokenForRefreshToken.mockResolvedValueOnce({ accessTokenId: "tok-stale", userId: "user-1", clientId: "cid" });
      findLiveAccessTokenIdsForClient.mockResolvedValueOnce(["tok-live"]);

      await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt-stolen" }));

      expect(burnUnusedRefreshTokensForClient).toHaveBeenCalledWith("service-client-marker", "user-1", "cid");
      expect(findLiveAccessTokenIdsForClient.mock.invocationCallOrder[0]).toBeLessThan(burnUnusedRefreshTokensForClient.mock.invocationCallOrder[0]);
      expect(revokeAccessToken).toHaveBeenCalledWith("service-client-marker", "user-1", "tok-live");
    });

    it("refuses to mint a fresh token if the one being refreshed no longer has scopes on record", async () => {
      rotateRefreshToken.mockResolvedValueOnce({ ok: true, userId: "user-1", clientId: "cid", oldAccessTokenId: "tok-old" });
      getTokenScopesById.mockResolvedValueOnce(null);

      const response = await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt-live" }));

      expect(response.status).toBe(400);
      expect(createAccessToken).not.toHaveBeenCalled();
    });

    it("on success: mints a NEW access token carrying the SAME scopes as the one it replaces, revokes the old one, and issues a new refresh token", async () => {
      rotateRefreshToken.mockResolvedValueOnce({ ok: true, userId: "user-1", clientId: "cid", oldAccessTokenId: "tok-old" });
      getTokenScopesById.mockResolvedValueOnce(["read"]); // the OLD token was read-only
      createAccessToken.mockResolvedValueOnce({ ok: true, token: "lifeos_pat_rotated", status: { id: "tok-new", scopes: ["read"] } });
      mintRefreshToken.mockResolvedValueOnce({ ok: true, refreshToken: "lifeos_oauthrefresh_rotated" });

      const response = await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt-live" }));

      expect(createAccessToken).toHaveBeenCalledWith("service-client-marker", "user-1", "OAuth: unnamed connector", ["read"], {
        clientKind: "mcp_oauth",
        expiresAt: expect.any(String),
      });
      expect(revokeAccessToken).toHaveBeenCalledWith("service-client-marker", "user-1", "tok-old");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.access_token).toBe("lifeos_pat_rotated");
      expect(body.scope).toBe("read"); // NOT widened to "read write"
      expect(body.refresh_token).toBe("lifeos_oauthrefresh_rotated");
      expect(body.expires_in).toBe(30 * 24 * 60 * 60); // P4-12: the refreshed token is also a 30-day token
    });

    it("P4-12: a refresh that hits the live-token cap returns the clear cap message and leaves the old token alone", async () => {
      rotateRefreshToken.mockResolvedValueOnce({ ok: true, userId: "user-1", clientId: "cid", oldAccessTokenId: "tok-old" });
      getTokenScopesById.mockResolvedValueOnce(["read"]);
      createAccessToken.mockResolvedValueOnce({ ok: false, message: "You already have 20 active tokens, which is the limit. Revoke one you no longer use in Settings, then try again." });

      const response = await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt-live" }));

      expect(response.status).toBe(500);
      expect((await response.json()).error_description).toMatch(/20 active tokens/);
      expect(revokeAccessToken).not.toHaveBeenCalled();
      expect(repointScheduledActionsToken).not.toHaveBeenCalled();
    });

    it("P4-11: re-points the user's scheduled actions old->new BEFORE revoking the old token", async () => {
      rotateRefreshToken.mockResolvedValueOnce({ ok: true, userId: "user-1", clientId: "cid", oldAccessTokenId: "tok-old" });
      getTokenScopesById.mockResolvedValueOnce(["read", "write"]);
      createAccessToken.mockResolvedValueOnce({ ok: true, token: "lifeos_pat_rotated", status: { id: "tok-new", scopes: ["read", "write"] } });
      mintRefreshToken.mockResolvedValueOnce({ ok: true, refreshToken: "lifeos_oauthrefresh_rotated" });

      const response = await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt-live" }));

      expect(response.status).toBe(200);
      expect(repointScheduledActionsToken).toHaveBeenCalledWith("service-client-marker", "user-1", "tok-old", "tok-new");
      expect(repointScheduledActionsToken.mock.invocationCallOrder[0]).toBeLessThan(revokeAccessToken.mock.invocationCallOrder[0]);
    });

    it("P4-11: a failed re-point fails the refresh closed -- revokes the NEW token, never the old one", async () => {
      rotateRefreshToken.mockResolvedValueOnce({ ok: true, userId: "user-1", clientId: "cid", oldAccessTokenId: "tok-old" });
      getTokenScopesById.mockResolvedValueOnce(["read"]);
      createAccessToken.mockResolvedValueOnce({ ok: true, token: "lifeos_pat_rotated", status: { id: "tok-new", scopes: ["read"] } });
      repointScheduledActionsToken.mockRejectedValueOnce(new Error("db down"));

      const response = await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt-live" }));

      expect(response.status).toBe(500);
      expect((await response.json()).error_description).not.toContain("db down"); // P4-13 nit: generic
      expect(revokeAccessToken).toHaveBeenCalledWith("service-client-marker", "user-1", "tok-new");
      expect(revokeAccessToken).not.toHaveBeenCalledWith("service-client-marker", "user-1", "tok-old");
      expect(mintRefreshToken).not.toHaveBeenCalled();
    });

    it("P4-11: REUSE DETECTED never re-points scheduled actions -- the stolen chain's schedules stay denied", async () => {
      rotateRefreshToken.mockResolvedValueOnce({ ok: false, error: "invalid_grant", message: "reused", reuseDetected: true });
      findAccessTokenForRefreshToken.mockResolvedValueOnce({ accessTokenId: "tok-stale", userId: "user-1", clientId: "cid" });
      findLiveAccessTokenIdsForClient.mockResolvedValueOnce(["tok-attacker"]);

      await POST(formRequest({ grant_type: "refresh_token", refresh_token: "rt-stolen" }));

      expect(repointScheduledActionsToken).not.toHaveBeenCalled();
    });
  });
});
