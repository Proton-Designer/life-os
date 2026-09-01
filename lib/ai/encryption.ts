import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * AES-256-GCM for user-supplied provider keys.
 *
 * WHY NOT JUST RLS: RLS is a query-time control. It does nothing for a database
 * dump, a backup, a leaked service-role credential, or a support session. A
 * provider key is a bearer credential that spends the user's money, so the
 * failure mode of a leak is a bill. The ciphertext is therefore useless without
 * `API_KEY_ENCRYPTION_SECRET`, which lives in the server environment and not in
 * the database — the two have to be compromised together.
 *
 * GCM rather than CBC because it is authenticated: a tampered ciphertext fails
 * to decrypt rather than silently yielding garbage that then gets sent to a
 * provider as if it were a key.
 *
 * FAILS CLOSED. If the secret is missing we throw rather than fall back to
 * storing plaintext. A "temporary" plaintext path is how credentials end up
 * unencrypted in production forever, and the whole point of this file is that
 * the database alone is worthless. The caller surfaces this as "key storage
 * isn't configured", which is honest — the user has done nothing wrong.
 */

const ALGORITHM = "aes-256-gcm";

function secret(): Buffer {
  const raw = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      "API_KEY_ENCRYPTION_SECRET is missing or too short (need >= 32 chars). " +
        "Refusing to store a credential unencrypted.",
    );
  }
  // scrypt rather than using the raw string as key material: it accepts any
  // length secret and produces exactly 32 bytes, with a deliberate work factor.
  // The salt is fixed BY DESIGN — this is key derivation from a single
  // server-held secret, not password hashing, and a per-record salt would have
  // to be stored beside the ciphertext without adding anything against an
  // attacker who already has both.
  return scryptSync(raw, "lifeos.user-api-keys.v1", 32);
}

/** Returns `iv:authTag:ciphertext`, all base64. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = createCipheriv(ALGORITHM, secret(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Stored key is malformed.");
  const decipher = createDecipheriv(ALGORITHM, secret(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** Is key storage usable at all? Lets the UI explain rather than fail on submit. */
export function isKeyStorageConfigured(): boolean {
  const raw = process.env.API_KEY_ENCRYPTION_SECRET;
  return Boolean(raw && raw.length >= 32);
}

/** Never store or display more than this. */
export function last4(key: string): string {
  return key.slice(-4);
}
