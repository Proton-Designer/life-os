import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const SECRET = "a".repeat(48);

function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

/**
 * `resolveStoredUserKey` is THE fix for a real bug (see its own header in
 * lib/ai/resolve-key.ts): `app/(app)/settings/api-key-actions.ts`'s
 * `testStoredKey()` used to call `resolveApiKey`, which falls through to the
 * shared server key whenever no user row exists -- letting any signed-in
 * user trigger a real, uncapped, unlogged provider call for a provider they
 * never configured a key for. This function's entire reason to exist is
 * that it CANNOT do that, structurally: it has no code path that reads
 * `DEEPSEEK_API_KEY` or any other server-side env var at all.
 */
describe("resolveStoredUserKey", () => {
  beforeEach(() => {
    process.env.API_KEY_ENCRYPTION_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.API_KEY_ENCRYPTION_SECRET;
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("returns the user's own decrypted key when one is stored", async () => {
    const { encryptSecret } = await import("../encryption");
    const { resolveStoredUserKey } = await import("../resolve-key");
    const rawKey = "sk-the-users-own-real-key-12345";
    const chain = makeChain({ data: { encrypted_key: encryptSecret(rawKey) }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const result = await resolveStoredUserKey(client, "user-1", "deepseek");
    expect(result).toBe(rawKey);
  });

  it("THE REGRESSION GUARD: returns null (never the server key) when the user has no stored row, even though a server key IS configured", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-shared-operator-funded-key-should-never-leak-here";
    const { resolveStoredUserKey } = await import("../resolve-key");
    const chain = makeChain({ data: null, error: null }); // maybeSingle finds nothing
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const result = await resolveStoredUserKey(client, "user-with-no-key", "deepseek");
    expect(result).toBeNull();
  });

  it("returns null (never falls through) on a query error, even with a server key configured", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-shared-operator-funded-key-should-never-leak-here";
    const { resolveStoredUserKey } = await import("../resolve-key");
    const chain = makeChain({ data: null, error: { message: "db error" } });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const result = await resolveStoredUserKey(client, "user-1", "deepseek");
    expect(result).toBeNull();
  });

  it("returns null (never falls through) when the stored ciphertext can't be decrypted, even with a server key configured", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-shared-operator-funded-key-should-never-leak-here";
    const { resolveStoredUserKey } = await import("../resolve-key");
    const chain = makeChain({ data: { encrypted_key: "not-valid-ciphertext" }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const result = await resolveStoredUserKey(client, "user-1", "deepseek");
    expect(result).toBeNull();
  });

  it("scopes the query to this user and this provider", async () => {
    const { resolveStoredUserKey } = await import("../resolve-key");
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await resolveStoredUserKey(client, "user-42", "deepseek");

    expect(client.from).toHaveBeenCalledWith("user_api_keys");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-42");
    expect(chain.eq).toHaveBeenCalledWith("provider", "deepseek");
  });
});

/**
 * Phase 1 multi-provider (2026-09-14): the shared operator-funded key
 * became an ALLOWLIST, not a fallback for everyone -- the DeepSeek spend
 * cap is $1.00 lifetime and GLOBAL, so a stranger on the shared key could
 * exhaust it and cut off Ayman's own AI access. These tests exercise the
 * REAL `sharedKeyAllowed`/`serverKey` logic, not a mock of it -- unlike
 * gateway.test.ts, which mocks `resolveApiKeyWithSource` entirely and so
 * never runs this code at all.
 */
describe("resolveApiKeyWithSource / resolveApiKey -- shared-key allowlist", () => {
  const noRow = { data: null, error: null };

  beforeEach(() => {
    delete process.env.AI_SHARED_KEY_POLICY;
    delete process.env.AI_SHARED_KEY_ALLOWED_USER_IDS;
    process.env.DEEPSEEK_API_KEY = "sk-shared-operator-key";
  });
  afterEach(() => {
    delete process.env.AI_SHARED_KEY_POLICY;
    delete process.env.AI_SHARED_KEY_ALLOWED_USER_IDS;
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("FAIL-SAFE: default policy (allowlist), no list configured -> the server key is withheld from EVERYONE, not granted to everyone", async () => {
    const { resolveApiKeyWithSource } = await import("../resolve-key");
    const client = { from: vi.fn(() => makeChain(noRow)) } as unknown as SupabaseClient;

    const result = await resolveApiKeyWithSource(client, "any-random-user", "deepseek");
    expect(result).toBeNull();
  });

  it("allowlisted user id -> gets the server key", async () => {
    process.env.AI_SHARED_KEY_ALLOWED_USER_IDS = "user-a, user-b ,user-c";
    const { resolveApiKeyWithSource } = await import("../resolve-key");
    const client = { from: vi.fn(() => makeChain(noRow)) } as unknown as SupabaseClient;

    const result = await resolveApiKeyWithSource(client, "user-b", "deepseek");
    expect(result).toEqual({ key: "sk-shared-operator-key", source: "server" });
  });

  it("non-allowlisted user id -> withheld, even with a real allowlist configured (not just an empty one)", async () => {
    process.env.AI_SHARED_KEY_ALLOWED_USER_IDS = "user-a,user-b";
    const { resolveApiKeyWithSource } = await import("../resolve-key");
    const client = { from: vi.fn(() => makeChain(noRow)) } as unknown as SupabaseClient;

    const result = await resolveApiKeyWithSource(client, "user-z", "deepseek");
    expect(result).toBeNull();
  });

  it('AI_SHARED_KEY_POLICY="everyone" -> restores the old fallback-for-anyone behavior, explicit opt-in only', async () => {
    process.env.AI_SHARED_KEY_POLICY = "everyone";
    const { resolveApiKeyWithSource } = await import("../resolve-key");
    const client = { from: vi.fn(() => makeChain(noRow)) } as unknown as SupabaseClient;

    const result = await resolveApiKeyWithSource(client, "any-random-user", "deepseek");
    expect(result).toEqual({ key: "sk-shared-operator-key", source: "server" });
  });

  it("a user's OWN stored key is NEVER gated by the allowlist -- it's their money, their key", async () => {
    process.env.API_KEY_ENCRYPTION_SECRET = SECRET;
    const { encryptSecret } = await import("../encryption");
    const { resolveApiKeyWithSource } = await import("../resolve-key");
    const rawKey = "sk-the-users-own-real-key";
    const chain = makeChain({ data: { encrypted_key: encryptSecret(rawKey) }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    // Default policy, no allowlist -- would withhold the SERVER key, but
    // this user has their own, which must never be gated by that policy.
    const result = await resolveApiKeyWithSource(client, "not-on-any-allowlist", "deepseek");
    expect(result).toEqual({ key: rawKey, source: "user" });
    delete process.env.API_KEY_ENCRYPTION_SECRET;
  });

  it("resolveApiKey (the older, non-source-tracking function) applies the identical gate, not a separate one", async () => {
    const { resolveApiKey } = await import("../resolve-key");
    const client = { from: vi.fn(() => makeChain(noRow)) } as unknown as SupabaseClient;

    expect(await resolveApiKey(client, "any-random-user", "deepseek")).toBeNull();

    process.env.AI_SHARED_KEY_ALLOWED_USER_IDS = "any-random-user";
    expect(await resolveApiKey(client, "any-random-user", "deepseek")).toBe("sk-shared-operator-key");
  });
});
