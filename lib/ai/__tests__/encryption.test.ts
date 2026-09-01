import { describe, expect, it, beforeEach, afterEach } from "vitest";

/**
 * The value of encrypting a user's provider key is entirely in the properties
 * asserted here. "It's encrypted" is not a claim a reader can check; these are.
 */

const SECRET = "a".repeat(48);

async function load() {
  // Re-imported per test so a changed process.env is actually read — the module
  // reads it at call time, but importing fresh keeps each case independent.
  return import("../encryption");
}

describe("user API key encryption", () => {
  beforeEach(() => {
    process.env.API_KEY_ENCRYPTION_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.API_KEY_ENCRYPTION_SECRET;
  });

  it("round-trips a key", async () => {
    const { encryptSecret, decryptSecret } = await load();
    const key = "sk-1234567890abcdefghijklmnop";
    expect(decryptSecret(encryptSecret(key))).toBe(key);
  });

  it("never stores the plaintext anywhere in the ciphertext", async () => {
    const { encryptSecret } = await load();
    const key = "sk-supersecretvalue1234567890";
    const stored = encryptSecret(key);
    expect(stored).not.toContain(key);
    expect(stored).not.toContain("supersecret");
  });

  it("produces different ciphertext each time (random IV), so equal keys aren't correlatable", async () => {
    const { encryptSecret } = await load();
    const key = "sk-1234567890abcdefghijklmnop";
    expect(encryptSecret(key)).not.toBe(encryptSecret(key));
  });

  it("REFUSES to decrypt tampered ciphertext rather than returning garbage", async () => {
    // The reason for GCM over CBC: a flipped byte must fail loudly, not yield
    // plausible bytes that then get sent to a provider as if they were a key.
    const { encryptSecret, decryptSecret } = await load();
    const stored = encryptSecret("sk-1234567890abcdefghijklmnop");
    const [iv, tag, data] = stored.split(":");
    const flipped = Buffer.from(data!, "base64");
    flipped[0] = flipped[0]! ^ 0xff;
    expect(() => decryptSecret([iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });

  it("cannot be decrypted with a different server secret", async () => {
    const { encryptSecret, decryptSecret } = await load();
    const stored = encryptSecret("sk-1234567890abcdefghijklmnop");
    process.env.API_KEY_ENCRYPTION_SECRET = "b".repeat(48);
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("FAILS CLOSED with no secret — never silently stores plaintext", async () => {
    const { encryptSecret, isKeyStorageConfigured } = await load();
    delete process.env.API_KEY_ENCRYPTION_SECRET;
    expect(isKeyStorageConfigured()).toBe(false);
    expect(() => encryptSecret("sk-1234567890abcdefghijklmnop")).toThrow(/refusing to store/i);
  });

  it("treats a too-short secret as unconfigured rather than weakly encrypting", async () => {
    const { isKeyStorageConfigured } = await load();
    process.env.API_KEY_ENCRYPTION_SECRET = "short";
    expect(isKeyStorageConfigured()).toBe(false);
  });

  it("last4 exposes only the tail", async () => {
    const { last4 } = await load();
    expect(last4("sk-abcdefgh8f2c")).toBe("8f2c");
  });
});
