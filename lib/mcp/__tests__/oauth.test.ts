import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import {
  verifyPkce,
  isValidRedirectUri,
  validateClientRegistration,
  registerOAuthClient,
  getOAuthClient,
  formatOAuthTokenLabel,
  mintAuthorizationCode,
  consumeAuthorizationCode,
  mintRefreshToken,
  findAccessTokenForRefreshToken,
  runRefreshGrant,
  parseScopeParam,
  AUTH_CODE_TTL_SECONDS,
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

  it("issues a client_id and normalizes the response shape on success", async () => {
    const insertChain = makeChain({
      data: { client_id: "lifeos_client_abc", client_name: "Claude", redirect_uris: ["https://a.example.com/cb"], created_at: "2026-09-09T00:00:00Z" },
      error: null,
    });
    const client = clientWithSequence([insertChain]); // P4-13: no global count query (no ipHash given)

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
    const client = clientWithSequence([insertChain]); // P4-13: no global count query (no ipHash given)

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

describe("formatOAuthTokenLabel — the actual /settings overflow + unreadable-label regression", () => {
  it("uses the registered client_name", () => {
    expect(formatOAuthTokenLabel({ client_name: "Claude" })).toBe("OAuth: Claude");
  });

  it("never contains a raw client_id — that was the bug", () => {
    const label = formatOAuthTokenLabel({ client_name: null });
    expect(label).not.toMatch(/lifeos_client_/);
  });

  it("falls back to an honest generic label when no client_name was registered, not the client_id", () => {
    expect(formatOAuthTokenLabel({ client_name: null })).toBe("OAuth: unnamed connector");
    expect(formatOAuthTokenLabel({ client_name: "" })).toBe("OAuth: unnamed connector");
    expect(formatOAuthTokenLabel({ client_name: "   " })).toBe("OAuth: unnamed connector");
  });

  it("handles a null client row (unknown client) the same as no name", () => {
    expect(formatOAuthTokenLabel(null)).toBe("OAuth: unnamed connector");
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

  it("passes expires_at on the insert — regression test for the bug the Lead found (23502, column never sent)", async () => {
    // This one mock CAN'T fail the way production did (a mock has no NOT
    // NULL constraint), which is exactly why lib/mcp/__tests__/
    // oauth-schema-coverage.test.ts exists alongside this — that file reads
    // migration 132's real DDL rather than trusting this list to stay
    // complete. Kept here too because it names the specific column the
    // specific bug forgot, which the schema-coverage test's generic sweep
    // does not surface as directly.
    const chain = makeChain({ data: null, error: null });
    const client = clientReturning(chain);
    await mintAuthorizationCode(client, baseParams);
    const insertArg = chain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.expires_at).toBeDefined();
    expect(typeof insertArg.expires_at).toBe("string");
    expect(new Date(insertArg.expires_at as string).getTime()).toBeGreaterThan(Date.now());
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

describe("runRefreshGrant — P4-13: the whole refresh grant is one SQL call (mcp_oauth_refresh_grant, migration 217)", () => {
  function rpcClient(result: { data: unknown; error: unknown }) {
    const rpc = vi.fn(async () => result);
    return { client: { rpc } as unknown as SupabaseClient, rpc };
  }
  const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

  it("sends ONLY hashes (and last4) of freshly generated secrets, and returns the raw values on ok", async () => {
    const { client, rpc } = rpcClient({ data: { outcome: "ok", access_token_id: "tok-new", scopes: ["read", "bogus"] }, error: null });
    const res = await runRefreshGrant(client, "lifeos_oauthrefresh_live", { label: "OAuth: Claude", expiresAt: "2026-10-15T00:00:00.000Z" });
    expect(res.outcome).toBe("ok");
    if (res.outcome !== "ok") return;
    const [name, args] = rpc.mock.calls[0] as unknown as [string, Record<string, string>];
    expect(name).toBe("mcp_oauth_refresh_grant");
    expect(args.p_refresh_token_hash).toBe(sha("lifeos_oauthrefresh_live"));
    expect(args.p_new_access_token_hash).toBe(sha(res.accessToken));
    expect(args.p_new_access_token_last4).toBe(res.accessToken.slice(-4));
    expect(args.p_new_refresh_token_hash).toBe(sha(res.refreshToken));
    expect(args.p_label).toBe("OAuth: Claude");
    expect(args.p_expires_at).toBe("2026-10-15T00:00:00.000Z");
    expect(res.accessToken.startsWith("lifeos_pat_")).toBe(true);
    expect(res.refreshToken.startsWith("lifeos_oauthrefresh_")).toBe(true);
    expect(JSON.stringify(args)).not.toContain(res.accessToken);
    expect(JSON.stringify(args)).not.toContain(res.refreshToken);
    expect(res.scopes).toEqual(["read"]); // unknown scope filtered
    expect(res.accessTokenId).toBe("tok-new");
  });

  it.each(["invalid", "reuse", "revoked"] as const)("passes outcome %s through, with no tokens", async (outcome) => {
    const { client } = rpcClient({ data: { outcome }, error: null });
    expect(await runRefreshGrant(client, "rt", { label: "l", expiresAt: "x" })).toEqual({ outcome });
  });

  it("maps the live-token cap trigger error to `cap`, any other DB error to `error`, and an unknown payload to `error`", async () => {
    expect((await runRefreshGrant(rpcClient({ data: null, error: { message: "mcp_token_cap: this account already has 20 live tokens" } }).client, "rt", { label: "l", expiresAt: "x" })).outcome).toBe("cap");
    expect((await runRefreshGrant(rpcClient({ data: null, error: { message: "boom" } }).client, "rt", { label: "l", expiresAt: "x" })).outcome).toBe("error");
    expect((await runRefreshGrant(rpcClient({ data: { outcome: "surprise" }, error: null }).client, "rt", { label: "l", expiresAt: "x" })).outcome).toBe("error");
    expect((await runRefreshGrant(rpcClient({ data: { outcome: "ok" }, error: null }).client, "rt", { label: "l", expiresAt: "x" })).outcome).toBe("error");
  });
});
