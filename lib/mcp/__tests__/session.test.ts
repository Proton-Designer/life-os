// @vitest-environment node
//
// ES256 signing needs a real WebCrypto `subtle` implementation. jsdom (this
// project's default test environment, vitest.config.ts) defines a `crypto`
// global but not a working `subtle` behind it, so `jose` silently picks a
// broken code path and `SignJWT.sign()` fails with an opaque
// "payload must be an instance of Uint8Array" — a jsdom artifact, not a bug
// in the signing code. Node's own environment has the real thing. HS256
// doesn't strictly need it (a raw Uint8Array key), but the suite shares one
// environment directive and the ES256 coverage below still needs it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPair, exportJWK, importJWK, jwtVerify } from "jose";

/**
 * HS256 with `SUPABASE_LEGACY_JWT_SECRET` is the LIVE path (session.ts's
 * own header has the full story: Supabase's dashboard has no import-your-
 * own-key option, so R4b's original ES256 plan was never actually
 * available — a previous "Legacy HS256 (Shared Secret)" key, tested
 * directly against production by the lead, is what this program actually
 * runs on). These tests never touch Supabase — they sign with a throwaway
 * secret and verify the result with `jose` directly, using the SAME
 * secret (symmetric signing has no separate public half to check
 * against).
 *
 * ES256 (`MCP_SIGNING_KEY_JWK`) is kept, inert, for the day self-signing
 * becomes possible again — covered below so it doesn't silently bit-rot,
 * but it is reachable ONLY when `SUPABASE_LEGACY_JWT_SECRET` is unset.
 */

const createClientMock = vi.fn((..._args: unknown[]) => ({ __fake: "supabase-client" }));
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

const ORIGINAL_ENV = { ...process.env };

async function freshEs256Keypair() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  return { publicJwk: await exportJWK(publicKey), privateJwk: await exportJWK(privateKey) };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SUPABASE_LEGACY_JWT_SECRET;
  delete process.env.MCP_SIGNING_KEY_JWK;
});

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  const { __resetSigningKeyCacheForTests } = await import("../session");
  __resetSigningKeyCacheForTests();
});

describe("mintSessionJwt — HS256 with SUPABASE_LEGACY_JWT_SECRET (the live path)", () => {
  it("mints a JWT that verifies against its OWN matching secret, with the right claims and no kid", async () => {
    process.env.SUPABASE_LEGACY_JWT_SECRET = "throwaway-legacy-secret";
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    const jwt = await mintSessionJwt("user-abc-123");

    const key = new TextEncoder().encode("throwaway-legacy-secret");
    const { payload, protectedHeader } = await jwtVerify(jwt, key);

    expect(payload.sub).toBe("user-abc-123");
    expect(payload.role).toBe("authenticated");
    expect(payload.aud).toBe("authenticated");
    expect(protectedHeader.alg).toBe("HS256");
    expect(protectedHeader.kid).toBeUndefined(); // symmetric key, no JWKS, nothing for kid to select
  });

  it("is short-lived: exp - iat is exactly the 5-minute TTL", async () => {
    process.env.SUPABASE_LEGACY_JWT_SECRET = "throwaway-legacy-secret";
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    const jwt = await mintSessionJwt("user-1");
    const { payload } = await jwtVerify(jwt, new TextEncoder().encode("throwaway-legacy-secret"));

    expect((payload.exp as number) - (payload.iat as number)).toBe(5 * 60);
  });

  it("REJECTS verification against a DIFFERENT secret — proves this is a real signature, not just a shaped token", async () => {
    process.env.SUPABASE_LEGACY_JWT_SECRET = "the-real-secret";
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    const jwt = await mintSessionJwt("user-1");
    const wrongKey = new TextEncoder().encode("a-completely-different-secret");

    await expect(jwtVerify(jwt, wrongKey)).rejects.toThrow();
  });

  it("mints distinct-looking tokens for different users from the same secret", async () => {
    process.env.SUPABASE_LEGACY_JWT_SECRET = "throwaway-legacy-secret";
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    const a = await mintSessionJwt("user-a");
    const b = await mintSessionJwt("user-b");
    expect(a).not.toBe(b);
  });

  it("is preferred over ES256 when BOTH env vars happen to be set — HS256 is unconditionally the live path, never a fallback behind it", async () => {
    process.env.SUPABASE_LEGACY_JWT_SECRET = "throwaway-legacy-secret";
    const { privateJwk } = await freshEs256Keypair();
    process.env.MCP_SIGNING_KEY_JWK = JSON.stringify(privateJwk);
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    const jwt = await mintSessionJwt("user-1");
    // Verifies against the HS256 secret, not the ES256 keypair -- proves
    // HS256 actually signed it, not merely that decoding the header says so.
    await expect(jwtVerify(jwt, new TextEncoder().encode("throwaway-legacy-secret"))).resolves.toBeTruthy();
  });

  it("throws a clear error naming SUPABASE_LEGACY_JWT_SECRET when neither env var is set", async () => {
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    await expect(mintSessionJwt("user-1")).rejects.toThrow(/SUPABASE_LEGACY_JWT_SECRET/);
  });
});

describe("mintSessionJwt — ES256 with MCP_SIGNING_KEY_JWK (kept inert, reachable only when the legacy secret is absent)", () => {
  it("mints a JWT that verifies against its OWN matching public key, with the right claims", async () => {
    const { publicJwk, privateJwk } = await freshEs256Keypair();
    process.env.MCP_SIGNING_KEY_JWK = JSON.stringify(privateJwk);
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    const jwt = await mintSessionJwt("user-abc-123");

    const publicKey = await importJWK(publicJwk, "ES256");
    const { payload, protectedHeader } = await jwtVerify(jwt, publicKey);

    expect(payload.sub).toBe("user-abc-123");
    expect(payload.role).toBe("authenticated");
    expect(payload.aud).toBe("authenticated");
    expect(protectedHeader.alg).toBe("ES256");
    expect(protectedHeader.kid).toBe("ff83fd87-4fbf-4ff4-9aae-f609538947e8");
  });

  it("REJECTS verification against a DIFFERENT public key", async () => {
    const { privateJwk } = await freshEs256Keypair();
    const { publicJwk: wrongPublicJwk } = await freshEs256Keypair();
    process.env.MCP_SIGNING_KEY_JWK = JSON.stringify(privateJwk);
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    const jwt = await mintSessionJwt("user-1");
    const wrongPublicKey = await importJWK(wrongPublicJwk, "ES256");

    await expect(jwtVerify(jwt, wrongPublicKey)).rejects.toThrow();
  });

  it("throws a clear error when MCP_SIGNING_KEY_JWK is not valid JSON", async () => {
    process.env.MCP_SIGNING_KEY_JWK = "not json";
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    await expect(mintSessionJwt("user-1")).rejects.toThrow(/valid JSON/);
  });

  it("mints successfully from a JWK carrying key_ops:['sign','verify'] — the exact shape `supabase gen signing-key` emits, and the exact shape that failed live on production with 'Unsupported key usage for a ECDSA key'", async () => {
    const { publicJwk, privateJwk } = await freshEs256Keypair();
    const asGenerated = { ...privateJwk, key_ops: ["sign", "verify"] };
    process.env.MCP_SIGNING_KEY_JWK = JSON.stringify(asGenerated);
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    const jwt = await mintSessionJwt("user-1");

    const publicKey = await importJWK(publicJwk, "ES256");
    const { payload } = await jwtVerify(jwt, publicKey);
    expect(payload.sub).toBe("user-1");
  });
});

describe("buildUserScopedClient", () => {
  beforeEach(() => {
    createClientMock.mockClear();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-placeholder";
  });

  it("sends the minted JWT as the Authorization header, which is what makes RLS apply as that user", async () => {
    const { buildUserScopedClient } = await import("../session");
    buildUserScopedClient("a.b.c");

    expect(createClientMock).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key-placeholder",
      expect.objectContaining({
        global: { headers: { Authorization: "Bearer a.b.c" } },
      }),
    );
  });

  it("never auto-persists or auto-refreshes — this client's lifetime is exactly one request", async () => {
    const { buildUserScopedClient } = await import("../session");
    buildUserScopedClient("a.b.c");

    const options = createClientMock.mock.calls[0][2] as { auth: Record<string, unknown> };
    expect(options.auth).toEqual(expect.objectContaining({ autoRefreshToken: false, persistSession: false }));
  });

  it("throws when the Supabase URL is missing rather than silently building a broken client", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { buildUserScopedClient } = await import("../session");
    expect(() => buildUserScopedClient("a.b.c")).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
