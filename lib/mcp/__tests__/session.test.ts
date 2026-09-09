// @vitest-environment node
//
// ES256 signing needs a real WebCrypto `subtle` implementation. jsdom (this
// project's default test environment, vitest.config.ts) defines a `crypto`
// global but not a working `subtle` behind it, so `jose` silently picks a
// broken code path and `SignJWT.sign()` fails with an opaque
// "payload must be an instance of Uint8Array" — a jsdom artifact, not a bug
// in the signing code. Node's own environment has the real thing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPair, exportJWK, importJWK, jwtVerify } from "jose";

/**
 * "Build and unit-test the signing regardless: you can verify your own JWT
 * against your own public key locally without Supabase" (L3 brief). These
 * tests never touch Supabase — they generate a throwaway ES256 keypair,
 * point `mintSessionJwt` at its private half via MCP_SIGNING_KEY_JWK, and
 * verify the result against the matching public half using `jose` directly.
 * Ayman's REAL keypair and its import into Supabase's JWKS are a one-time
 * setup step outside this repo (R4b) — this suite proves the signing
 * mechanism is correct independent of whether that step has happened yet.
 */

const createClientMock = vi.fn((..._args: unknown[]) => ({ __fake: "supabase-client" }));
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

const ORIGINAL_ENV = { ...process.env };

async function freshKeypair() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  return { publicJwk: await exportJWK(publicKey), privateJwk: await exportJWK(privateKey) };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  const { __resetSigningKeyCacheForTests } = await import("../session");
  __resetSigningKeyCacheForTests();
});

describe("mintSessionJwt", () => {
  it("mints a JWT that verifies against its OWN matching public key, with the right claims", async () => {
    const { publicJwk, privateJwk } = await freshKeypair();
    process.env.MCP_SIGNING_KEY_JWK = JSON.stringify(privateJwk);
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    const jwt = await mintSessionJwt("user-abc-123");

    const publicKey = await importJWK(publicJwk, "ES256");
    const { payload, protectedHeader } = await jwtVerify(jwt, publicKey);

    expect(payload.sub).toBe("user-abc-123");
    expect(payload.role).toBe("authenticated");
    expect(protectedHeader.alg).toBe("ES256");
    expect(protectedHeader.kid).toBe("ff83fd87-4fbf-4ff4-9aae-f609538947e8");
  });

  it("is short-lived: exp - iat is exactly the 5-minute TTL", async () => {
    const { publicJwk, privateJwk } = await freshKeypair();
    process.env.MCP_SIGNING_KEY_JWK = JSON.stringify(privateJwk);
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    const jwt = await mintSessionJwt("user-1");
    const publicKey = await importJWK(publicJwk, "ES256");
    const { payload } = await jwtVerify(jwt, publicKey);

    expect((payload.exp as number) - (payload.iat as number)).toBe(5 * 60);
  });

  it("REJECTS verification against a DIFFERENT public key — proves this is a real signature, not just a shaped token", async () => {
    const { privateJwk } = await freshKeypair();
    const { publicJwk: wrongPublicJwk } = await freshKeypair(); // a second, unrelated keypair
    process.env.MCP_SIGNING_KEY_JWK = JSON.stringify(privateJwk);
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    const jwt = await mintSessionJwt("user-1");
    const wrongPublicKey = await importJWK(wrongPublicJwk, "ES256");

    await expect(jwtVerify(jwt, wrongPublicKey)).rejects.toThrow();
  });

  it("throws a clear error when MCP_SIGNING_KEY_JWK is unset, rather than minting anything", async () => {
    delete process.env.MCP_SIGNING_KEY_JWK;
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    await expect(mintSessionJwt("user-1")).rejects.toThrow(/MCP_SIGNING_KEY_JWK/);
  });

  it("throws a clear error when MCP_SIGNING_KEY_JWK is not valid JSON", async () => {
    process.env.MCP_SIGNING_KEY_JWK = "not json";
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    await expect(mintSessionJwt("user-1")).rejects.toThrow(/valid JSON/);
  });

  it("mints distinct-looking tokens for different users from the same key", async () => {
    const { privateJwk } = await freshKeypair();
    process.env.MCP_SIGNING_KEY_JWK = JSON.stringify(privateJwk);
    const { mintSessionJwt, __resetSigningKeyCacheForTests } = await import("../session");
    __resetSigningKeyCacheForTests();

    const a = await mintSessionJwt("user-a");
    const b = await mintSessionJwt("user-b");
    expect(a).not.toBe(b);
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
