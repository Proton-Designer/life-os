import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import {
  verifyPkce,
  isValidRedirectUri,
  validateClientRegistration,
  registerOAuthClient,
  getOAuthClient,
  mintAuthorizationCode,
  consumeAuthorizationCode,
  mintRefreshToken,
  rotateRefreshToken,
  findAccessTokenForRefreshToken,
  findLiveAccessTokenIdsForClient,
  parseScopeParam,
  AUTH_CODE_TTL_SECONDS,
  MAX_REGISTERED_CLIENTS,
} from "../oauth";

/** Same idiom as lib/mcp/__tests__/tokens.test.ts's makeChain, generalized to carry an arbitrary resolved shape (e.g. `count`). */
function makeChain(resolved: Record<string, unknown> = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "eq", "is", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => resolved);
  chain.maybeSingle = vi.fn(async () => resolved);
  chain.then = (resolve: (v: typeof resolved) => void) => resolve(resolved);
  return chain as unknown as {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
}

function clientReturning(chain: ReturnType<typeof makeChain>): SupabaseClient {
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

/**
 * A sequence of DIFFERENT chains for a function that calls `supabase.from()`
 * more than once (e.g. registerOAuthClient's count-check then insert, or
 * rotateRefreshToken's lookup then update). Each call to `.from()` pops the
 * next chain off the queue.
 */
function clientWithSequence(chains: ReturnType<typeof makeChain>[]): SupabaseClient {
  const queue = [...chains];
  return { from: vi.fn(() => queue.shift() ?? makeChain()) } as unknown as SupabaseClient;
}

function pkcePair(verifier = "a-real-verifier-that-is-at-least-43-characters-long-per-rfc7636") {
  const challenge = createHash("sha256").update(verifier, "utf8").digest("base64url");
  return { verifier, challenge };
}

describe("verifyPkce", () => {
  it("accepts a correctly-derived challenge", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("rejects a mismatched verifier/challenge pair", () => {
    const { challenge } = pkcePair();
    expect(verifyPkce("a-completely-different-verifier-value-of-similar-length", challenge)).toBe(false);
  });

  it("rejects an empty verifier or challenge", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifyPkce("", challenge)).toBe(false);
    expect(verifyPkce(verifier, "")).toBe(false);
  });
});

describe("isValidRedirectUri", () => {
  it("accepts https — every real target (Claude/ChatGPT/Gemini callback hosts) is https", () => {
    expect(isValidRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
  });

  it("accepts the RFC 8252 loopback exception, http only for localhost/127.0.0.1", () => {
    expect(isValidRedirectUri("http://127.0.0.1:8080/callback")).toBe(true);
    expect(isValidRedirectUri("http://localhost:3000/callback")).toBe(true);
  });

  it("rejects http for any non-loopback host — the classic open-redirect-adjacent mistake", () => {
    expect(isValidRedirectUri("http://evil.example.com/callback")).toBe(false);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(isValidRedirectUri("javascript:alert(1)")).toBe(false);
  });

  it("rejects a malformed URL rather than throwing", () => {
    expect(isValidRedirectUri("not a url at all")).toBe(false);
  });
});

describe("validateClientRegistration", () => {
  it("accepts a well-formed request", () => {
    const result = validateClientRegistration({
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      client_name: "Claude",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.redirectUris).toEqual(["https://claude.ai/api/mcp/auth_callback"]);
      expect(result.clientName).toBe("Claude");
    }
  });

  it("rejects a missing/empty redirect_uris", () => {
    expect(validateClientRegistration({ redirect_uris: [] }).ok).toBe(false);
    expect(validateClientRegistration({}).ok).toBe(false);
  });

  it("rejects more than 10 redirect_uris", () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`);
    expect(validateClientRegistration({ redirect_uris: many }).ok).toBe(false);
  });

  it("rejects any invalid uri in the array, not just the first", () => {
    const result = validateClientRegistration({
      redirect_uris: ["https://good.example.com/cb", "http://bad.example.com/cb"],
    });
    expect(result.ok).toBe(false);
  });

  it("treats a blank client_name as absent, and truncates a very long one", () => {
    const blank = validateClientRegistration({ redirect_uris: ["https://a.example.com/cb"], client_name: "   " });
    expect(blank.ok && blank.clientName).toBeNull();

    const long = validateClientRegistration({
      redirect_uris: ["https://a.example.com/cb"],
      client_name: "x".repeat(500),
    });
    expect(long.ok && long.clientName?.length).toBe(200);
  });
});

describe("parseScopeParam", () => {
  it("returns an empty array for an omitted/blank scope, leaving the default to the caller", () => {
    expect(parseScopeParam(undefined)).toEqual([]);
    expect(parseScopeParam(null)).toEqual([]);
    expect(parseScopeParam("   ")).toEqual([]);
  });

  it("parses a single scope", () => {
    expect(parseScopeParam("read")).toEqual(["read"]);
  });

  it("parses space-separated scopes and de-duplicates", () => {
    expect(parseScopeParam("read write read")).toEqual(["read", "write"]);
  });

  it("REJECTS (returns null for) an unknown scope, rather than silently dropping it", () => {
    expect(parseScopeParam("read admin")).toBeNull();
  });
});

describe("registerOAuthClient", () => {
  it("rejects invalid metadata before ever touching the database", async () => {
    const chain = makeChain();
    const client = clientReturning(chain);
    const result = await registerOAuthClient(client, { redirect_uris: [] });
    expect(result.ok).toBe(false);
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it("refuses to register past the client-count ceiling", async () => {
    const client = clientWithSequence([makeChain({ count: MAX_REGISTERED_CLIENTS, error: null })]);
    const result = await registerOAuthClient(client, { redirect_uris: ["https://a.example.com/cb"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(429);
    }
  });

  it("issues a client_id and normalizes the response shape on success", async () => {
    const insertChain = makeChain({
      data: { client_id: "lifeos_client_abc", client_name: "Claude", redirect_uris: ["https://a.example.com/cb"], created_at: "2026-09-09T00:00:00Z" },
      error: null,
    });
    const client = clientWithSequence([makeChain({ count: 0, error: null }), insertChain]);

    const result = await registerOAuthClient(client, { redirect_uris: ["https://a.example.com/cb"], client_name: "Claude" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.client.client_id).toBe("lifeos_client_abc");
      expect(result.client.token_endpoint_auth_method).toBe("none");
      expect(result.client.grant_types).toEqual(["authorization_code", "refresh_token"]);
    }
  });

  it("normalizes an unsupported token_endpoint_auth_method rather than rejecting the registration", async () => {
    const insertChain = makeChain({
      data: { client_id: "lifeos_client_xyz", client_name: null, redirect_uris: ["https://a.example.com/cb"], created_at: "2026-09-09T00:00:00Z" },
      error: null,
    });
    const client = clientWithSequence([makeChain({ count: 0, error: null }), insertChain]);

    const result = await registerOAuthClient(client, {
      redirect_uris: ["https://a.example.com/cb"],
      token_endpoint_auth_method: "client_secret_post",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.client.token_endpoint_auth_method).toBe("none");
  });
});

describe("getOAuthClient", () => {
  it("returns null for an unknown client_id rather than throwing", async () => {
    const client = clientReturning(makeChain({ data: null, error: null }));
    expect(await getOAuthClient(client, "no-such-client")).toBeNull();
  });

  it("returns the row for a known client_id", async () => {
    const row = { client_id: "lifeos_client_abc", client_name: "Claude", redirect_uris: ["https://a.example.com/cb"], created_at: "2026-09-09T00:00:00Z" };
    const client = clientReturning(makeChain({ data: row, error: null }));
    expect(await getOAuthClient(client, "lifeos_client_abc")).toEqual(row);
  });
});

describe("mintAuthorizationCode", () => {
  const baseParams = {
    clientId: "lifeos_client_abc",
    userId: "user-1",
    redirectUri: "https://a.example.com/cb",
    codeChallenge: "some-challenge",
    codeChallengeMethod: "S256",
    scopes: ["read" as const],
  };

  it("REJECTS 'plain' as a code_challenge_method — PKCE downgrade is not accepted", async () => {
    const chain = makeChain();
    const client = clientReturning(chain);
    const result = await mintAuthorizationCode(client, { ...baseParams, codeChallengeMethod: "plain" });
    expect(result.ok).toBe(false);
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it("rejects an empty scopes array", async () => {
    const chain = makeChain();
    const client = clientReturning(chain);
    const result = await mintAuthorizationCode(client, { ...baseParams, scopes: [] });
    expect(result.ok).toBe(false);
  });

  it("mints a code and stores only its hash", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = clientReturning(chain);
    const result = await mintAuthorizationCode(client, baseParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code.startsWith("lifeos_oauthcode_")).toBe(true);
      const insertArg = chain.insert.mock.calls[0][0] as Record<string, unknown>;
      expect(JSON.stringify(insertArg)).not.toContain(result.code);
    }
  });
});

describe("consumeAuthorizationCode — the negative cases are the point", () => {
  const { verifier, challenge } = pkcePair();
  const liveRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: "code-1",
    client_id: "lifeos_client_abc",
    user_id: "user-1",
    redirect_uri: "https://a.example.com/cb",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: null,
    scopes: ["read", "write"],
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000).toISOString(),
    used_at: new Date().toISOString(),
    ...overrides,
  });
  const goodParams = { rawCode: "lifeos_oauthcode_whatever", clientId: "lifeos_client_abc", redirectUri: "https://a.example.com/cb", codeVerifier: verifier };

  it("REJECTS when the UPDATE matches no row (already used, or never existed) — no separate read-then-write window", async () => {
    const client = clientReturning(makeChain({ data: null, error: null }));
    const result = await consumeAuthorizationCode(client, goodParams);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_grant");
  });

  it("REJECTS an expired code", async () => {
    const client = clientReturning(makeChain({ data: liveRow({ expires_at: new Date(Date.now() - 1000).toISOString() }), error: null }));
    const result = await consumeAuthorizationCode(client, goodParams);
    expect(result.ok).toBe(false);
  });

  it("REJECTS a client_id mismatch", async () => {
    const client = clientReturning(makeChain({ data: liveRow(), error: null }));
    const result = await consumeAuthorizationCode(client, { ...goodParams, clientId: "some-other-client" });
    expect(result.ok).toBe(false);
  });

  it("REJECTS a redirect_uri mismatch", async () => {
    const client = clientReturning(makeChain({ data: liveRow(), error: null }));
    const result = await consumeAuthorizationCode(client, { ...goodParams, redirectUri: "https://different.example.com/cb" });
    expect(result.ok).toBe(false);
  });

  it("REJECTS a wrong code_verifier (PKCE failure)", async () => {
    const client = clientReturning(makeChain({ data: liveRow(), error: null }));
    const result = await consumeAuthorizationCode(client, { ...goodParams, codeVerifier: "the-wrong-verifier-value-entirely" });
    expect(result.ok).toBe(false);
  });

  it("ACCEPTS a correct redemption and returns the scopes/user/resource", async () => {
    const client = clientReturning(makeChain({ data: liveRow({ resource: "https://lifeos.example.com/api/mcp" }), error: null }));
    const result = await consumeAuthorizationCode(client, goodParams);
    expect(result).toEqual({ ok: true, userId: "user-1", scopes: ["read", "write"], resource: "https://lifeos.example.com/api/mcp" });
  });
});

describe("mintRefreshToken / findAccessTokenForRefreshToken", () => {
  it("mints a prefixed, hash-only-stored refresh token", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = clientReturning(chain);
    const result = await mintRefreshToken(client, { accessTokenId: "tok-1", clientId: "lifeos_client_abc", userId: "user-1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.refreshToken.startsWith("lifeos_oauthrefresh_")).toBe(true);
      const insertArg = chain.insert.mock.calls[0][0] as Record<string, unknown>;
      expect(JSON.stringify(insertArg)).not.toContain(result.refreshToken);
    }
  });

  it("finds the linked access_token_id, user_id, and client_id", async () => {
    const client = clientReturning(makeChain({ data: { access_token_id: "tok-1", user_id: "user-1", client_id: "lifeos_client_abc" }, error: null }));
    expect(await findAccessTokenForRefreshToken(client, "lifeos_oauthrefresh_whatever")).toEqual({
      accessTokenId: "tok-1",
      userId: "user-1",
      clientId: "lifeos_client_abc",
    });
  });

  it("returns null for an unknown refresh token", async () => {
    const client = clientReturning(makeChain({ data: null, error: null }));
    expect(await findAccessTokenForRefreshToken(client, "lifeos_oauthrefresh_unknown")).toBeNull();
  });
});

describe("findLiveAccessTokenIdsForClient — the actual reuse-detection target", () => {
  it("returns every access_token_id still linked to a not-yet-rotated refresh token row", async () => {
    const client = clientReturning(makeChain({ data: [{ access_token_id: "tok-live-1" }, { access_token_id: "tok-live-2" }], error: null }));
    expect(await findLiveAccessTokenIdsForClient(client, "user-1", "lifeos_client_abc")).toEqual(["tok-live-1", "tok-live-2"]);
  });

  it("returns an empty array when nothing is live (or on a DB error) rather than throwing", async () => {
    const client = clientReturning(makeChain({ data: null, error: { message: "boom" } }));
    expect(await findLiveAccessTokenIdsForClient(client, "user-1", "lifeos_client_abc")).toEqual([]);
  });
});

describe("rotateRefreshToken — reuse detection is the point", () => {
  it("REJECTS an unknown refresh token", async () => {
    const client = clientReturning(makeChain({ data: null, error: null }));
    const result = await rotateRefreshToken(client, "lifeos_oauthrefresh_unknown");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reuseDetected).toBe(false);
  });

  it("FLAGS reuse when the token was already rotated — this is the theft-detection signal", async () => {
    const lookupChain = makeChain({
      data: { id: "rt-1", access_token_id: "tok-1", client_id: "lifeos_client_abc", user_id: "user-1", rotated_at: "2026-09-09T00:00:00Z" },
      error: null,
    });
    const client = clientReturning(lookupChain);
    const result = await rotateRefreshToken(client, "lifeos_oauthrefresh_already-used");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reuseDetected).toBe(true);
    // Must not have attempted the rotating UPDATE for an already-rotated row.
    expect(lookupChain.update).not.toHaveBeenCalled();
  });

  it("ROTATES a live (never-used) refresh token exactly once", async () => {
    const client = clientWithSequence([
      makeChain({ data: { id: "rt-1", access_token_id: "tok-1", client_id: "lifeos_client_abc", user_id: "user-1", rotated_at: null }, error: null }),
      makeChain({ data: { id: "rt-1", access_token_id: "tok-1", client_id: "lifeos_client_abc", user_id: "user-1" }, error: null }),
    ]);
    const result = await rotateRefreshToken(client, "lifeos_oauthrefresh_live");
    expect(result).toEqual({ ok: true, userId: "user-1", clientId: "lifeos_client_abc", oldAccessTokenId: "tok-1" });
  });

  it("treats a lost race (the UPDATE matches nothing) the same as reuse", async () => {
    const client = clientWithSequence([
      makeChain({ data: { id: "rt-1", access_token_id: "tok-1", client_id: "lifeos_client_abc", user_id: "user-1", rotated_at: null }, error: null }),
      makeChain({ data: null, error: null }),
    ]);
    const result = await rotateRefreshToken(client, "lifeos_oauthrefresh_raced");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reuseDetected).toBe(true);
  });
});
