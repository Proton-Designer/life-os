import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `testStoredKey` is the exact site of a real bug found in an adversarial
 * verification pass (2026-09-13): it used to resolve a key via
 * `resolveApiKey`, which falls through to the shared, operator-funded
 * server key whenever the calling user has none of their own stored --
 * and this server action has NO server-side guard of its own (the
 * Settings UI only renders its "Test key" button when a key is already
 * stored -- components/settings/api-key-settings.tsx:106 -- which is a
 * display choice, not an authorization boundary). Any signed-in user could
 * call it directly for a provider they never configured and trigger a
 * real, uncapped, unlogged call against the shared balance.
 *
 * These tests exercise the REAL `resolveStoredUserKey` (not mocked) against
 * a fake supabase chain, with `verifyKey` mocked only to observe whether it
 * is ever reached -- the thing that must be provably true is "no stored
 * key -> verifyKey is never called," not just "the message says no key."
 */

function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

const verifyKeyMock = vi.fn(async (..._args: unknown[]) => ({ ok: true, content: "ok" }));
vi.mock("@/lib/ai/client", () => ({
  verifyKey: (...args: unknown[]) => verifyKeyMock(...args),
}));

let currentChain: Record<string, ReturnType<typeof vi.fn>>;
const requireUserMock = vi.fn(async () => ({
  supabase: { from: vi.fn(() => currentChain) } as unknown as SupabaseClient,
  userId: "user-1",
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: () => requireUserMock(),
}));

const SECRET = "a".repeat(48);

describe("testStoredKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_KEY_ENCRYPTION_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.API_KEY_ENCRYPTION_SECRET;
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("THE BUG THIS GUARDS: refuses (no verifyKey call) when the user has no stored key, even though a server key is configured -- the exact bypass shape found 2026-09-13", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-shared-operator-funded-key-should-never-leak-here";
    currentChain = makeChain({ data: null, error: null }); // no user_api_keys row
    const { testStoredKey } = await import("../api-key-actions");

    const result = await testStoredKey("deepseek");

    expect(result).toEqual({ ok: false, message: "No key stored for this provider." });
    expect(verifyKeyMock).not.toHaveBeenCalled();
  });

  it("verifies the user's own stored key when one exists, and never touches the server key", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-shared-operator-funded-key-should-never-leak-here";
    const { encryptSecret } = await import("@/lib/ai/encryption");
    const rawUserKey = "sk-the-users-own-real-key-12345";
    currentChain = makeChain({ data: { encrypted_key: encryptSecret(rawUserKey) }, error: null });
    const { testStoredKey } = await import("../api-key-actions");

    const result = await testStoredKey("deepseek");

    expect(result).toEqual({ ok: true, message: "Key is working." });
    expect(verifyKeyMock).toHaveBeenCalledTimes(1);
    expect(verifyKeyMock).toHaveBeenCalledWith("deepseek", rawUserKey);
  });

  it("rejects an unknown provider before ever resolving a key", async () => {
    currentChain = makeChain({ data: null, error: null });
    const { testStoredKey } = await import("../api-key-actions");

    const result = await testStoredKey("not-a-real-provider");

    expect(result).toEqual({ ok: false, message: "Unknown provider." });
    expect(verifyKeyMock).not.toHaveBeenCalled();
  });

  it("surfaces verifyKey's own failure message when the user's stored key no longer works", async () => {
    const { encryptSecret } = await import("@/lib/ai/encryption");
    currentChain = makeChain({ data: { encrypted_key: encryptSecret("sk-now-revoked") }, error: null });
    verifyKeyMock.mockResolvedValueOnce({ ok: false, message: "That key was revoked." } as never);
    const { testStoredKey } = await import("../api-key-actions");

    const result = await testStoredKey("deepseek");

    expect(result).toEqual({ ok: false, message: "That key was revoked." });
  });
});
