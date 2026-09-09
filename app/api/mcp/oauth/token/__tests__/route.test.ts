import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => "service-client-marker") }));

const consumeAuthorizationCode = vi.fn();
const rotateRefreshToken = vi.fn();
const mintRefreshToken = vi.fn();
const findAccessTokenForRefreshToken = vi.fn();
const findLiveAccessTokenIdsForClient = vi.fn();
vi.mock("@/lib/mcp/oauth", () => ({
  consumeAuthorizationCode: (...args: unknown[]) => consumeAuthorizationCode(...args),
  rotateRefreshToken: (...args: unknown[]) => rotateRefreshToken(...args),
  mintRefreshToken: (...args: unknown[]) => mintRefreshToken(...args),
  findAccessTokenForRefreshToken: (...args: unknown[]) => findAccessTokenForRefreshToken(...args),
  findLiveAccessTokenIdsForClient: (...args: unknown[]) => findLiveAccessTokenIdsForClient(...args),
}));

const createAccessToken = vi.fn();
const revokeAccessToken = vi.fn();
const getTokenScopesById = vi.fn();
vi.mock("@/lib/mcp/tokens", () => ({
  createAccessToken: (...args: unknown[]) => createAccessToken(...args),
  revokeAccessToken: (...args: unknown[]) => revokeAccessToken(...args),
  getTokenScopesById: (...args: unknown[]) => getTokenScopesById(...args),
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
  createAccessToken.mockReset();
  revokeAccessToken.mockReset();
  getTokenScopesById.mockReset();
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

    it("on success: mints an access token AND a refresh token, and NEVER returns expires_in (no clock-based expiry — see route header)", async () => {
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
      expect(body).not.toHaveProperty("expires_in");
      expect(createAccessToken).toHaveBeenCalledWith("service-client-marker", "user-1", "OAuth: cid", ["read", "write"]);
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

      expect(createAccessToken).toHaveBeenCalledWith("service-client-marker", "user-1", "OAuth: cid", ["read"]);
      expect(revokeAccessToken).toHaveBeenCalledWith("service-client-marker", "user-1", "tok-old");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.access_token).toBe("lifeos_pat_rotated");
      expect(body.scope).toBe("read"); // NOT widened to "read write"
      expect(body.refresh_token).toBe("lifeos_oauthrefresh_rotated");
    });
  });
});
