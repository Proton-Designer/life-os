import "server-only";
import { SignJWT, importJWK, type JWK } from "jose";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * R4 (PROGRAM-PLAN.md): the locally-signed session JWT, minted per MCP
 * request with ZERO Auth-server round trips — the mirror image of the
 * local ES256 *verify* `getClaims()` already does (lib/supabase/auth.ts:
 * 10-13) for a cookie session.
 *
 * WHY HS256 WITH A LEGACY SHARED SECRET, NOT ES256 — this is the second
 * design here, and the reason is not laziness: R4b's original plan
 * (generate an ES256 keypair, import the PUBLIC half into Supabase's JWT
 * Signing Keys, self-sign with the PRIVATE half) is IMPOSSIBLE on this
 * project. The owner checked Supabase's actual dashboard (JWT Keys page,
 * 2026-09-09): it offers "Create Standby Key" only — there is no
 * import-your-own-key path at all. `MCP_SIGNING_KEY_JWK`/the ES256 code
 * path below were built against a setup step that was never actually
 * available; they are kept, inert, in case that ever changes (see
 * `signingMaterial()`), not because they were wrong to build.
 *
 * What the dashboard's key list DOES show is a **previous** key: "Legacy
 * HS256 (Shared Secret)" — still valid for verifying tokens that haven't
 * expired. The lead tested this directly against production before
 * building on it: a symmetric HS256 JWT (sub=<real user>, role=
 * authenticated, aud=authenticated, 5m exp), signed with that secret, was
 * ACCEPTED by PostgREST and RLS scoped correctly to that one user's own
 * rows — the identical guarantee the ES256 design was after, available
 * today with a shared secret instead of a keypair.
 *
 * ⚠️ THE FRAGILITY, WRITTEN DOWN SO IT IS NOT ONLY IN A CREDENTIALS FILE:
 * Supabase's own dashboard labels this key "previous... revoke once all
 * tokens have expired." It is a legacy artifact kept around for exactly
 * this kind of transition, not a permanent credential. REVOKING IT BREAKS
 * THIS CONNECTOR — every read and write tool mints its session through
 * this file, and there is no fallback once it's gone except reverting to
 * this exact problem (no self-signing path exists) or a real architecture
 * change. If `SUPABASE_LEGACY_JWT_SECRET` starts failing verification
 * with no code change here, check the Supabase dashboard's JWT Keys page
 * for a revocation before assuming a bug in this file.
 */
const SESSION_TTL_SECONDS = 5 * 60; // short-lived by design — Supabase's own signing-keys docs: "prefer shorter-lived tokens"

type SigningMaterial = { alg: "HS256"; key: Uint8Array } | { alg: "ES256"; key: Awaited<ReturnType<typeof importJWK>>; kid: string };

let cachedMaterial: SigningMaterial | null = null;

/**
 * HS256 with `SUPABASE_LEGACY_JWT_SECRET` is the LIVE path, checked first
 * and unconditionally preferred — it is NOT a fallback behind ES256, and
 * must never become conditional on `MCP_SIGNING_KEY_JWK` being absent or
 * present (that key is dead weight kept only for the day self-signing
 * becomes possible again, which nothing here should assume). ES256 is
 * only reachable at all if someone explicitly sets `MCP_SIGNING_KEY_JWK`
 * back up on top of a real Signing Keys import — a state this project is
 * not in today.
 */
async function signingMaterial(): Promise<SigningMaterial> {
  if (cachedMaterial) return cachedMaterial;

  const legacySecret = process.env.SUPABASE_LEGACY_JWT_SECRET;
  if (legacySecret) {
    cachedMaterial = { alg: "HS256", key: new TextEncoder().encode(legacySecret) };
    return cachedMaterial;
  }

  const rawJwk = process.env.MCP_SIGNING_KEY_JWK;
  if (rawJwk) {
    let jwk: JWK;
    try {
      jwk = JSON.parse(rawJwk) as JWK;
    } catch {
      throw new Error("MCP_SIGNING_KEY_JWK is not valid JSON.");
    }
    const key = await importJWK(normalizeForSigning(jwk), "ES256");
    cachedMaterial = { alg: "ES256", key, kid: ES256_KID };
    return cachedMaterial;
  }

  throw new Error(
    "SUPABASE_LEGACY_JWT_SECRET is not set. The MCP connector cannot mint sessions without it — " +
      "see lib/mcp/session.ts's own header for why this is the live path (Supabase's dashboard has " +
      "no import-your-own-key option, so ES256 self-signing is not available on this project).",
  );
}

/**
 * KID for the ES256 path only — must match exactly what was (or will be)
 * imported into Supabase's JWKS on that side. Meaningless for HS256, which
 * carries no `kid` at all (a symmetric key isn't published in a JWKS and
 * has nothing for a `kid` to select between).
 */
const ES256_KID = "ff83fd87-4fbf-4ff4-9aae-f609538947e8";

/**
 * `supabase gen signing-key --algorithm ES256` emits a JWK with
 * `key_ops: ["sign", "verify"]`, because the JWK describes a whole
 * keypair's public+private material, not a single usage. WebCrypto, by
 * spec, only permits `["sign"]` on an ECDSA PRIVATE key — `"verify"` is a
 * public-key operation — so `importJWK` rejects the as-generated JWK with
 * `Unsupported key usage for a ECDSA key`. Diagnosed live on production
 * (team-lead) and reproduced locally against three variants of the real
 * generated key: as-generated fails with that exact string, `key_ops`
 * stripped entirely succeeds, `key_ops: ["sign"]` also succeeds. Stripping
 * is what this does — deleting the field before use looks like superstition
 * to the next reader without this paragraph, so it's written down here
 * rather than left as a bare `delete`. Kept for the ES256 path only; HS256
 * has no JWK and no `key_ops` question at all.
 */
function normalizeForSigning(jwk: JWK): JWK {
  const { key_ops, ...rest } = jwk;
  return rest;
}

/**
 * Mints a short-lived, locally-signed session JWT for `userId`. Pure local
 * crypto — no network call, no Supabase Auth involvement. R4a's caveat
 * applies to the CALLER, not here: this function signs whatever `userId` it
 * is given: it is the caller's job (verifyAccessToken + an explicit active-
 * user check) to have already confirmed that id is real and not
 * banned/deleted before ever reaching this function, since signing bypasses
 * every check GoTrue would otherwise have made.
 */
export async function mintSessionJwt(userId: string): Promise<string> {
  const material = await signingMaterial();
  const now = Math.floor(Date.now() / 1000);
  const signer = new SignJWT({ role: "authenticated", aud: "authenticated" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS);

  if (material.alg === "HS256") {
    return signer.setProtectedHeader({ alg: "HS256" }).sign(material.key);
  }
  return signer.setProtectedHeader({ alg: "ES256", kid: material.kid }).sign(material.key);
}

/**
 * Builds an RLS-scoped Supabase client from a minted session JWT — the
 * consuming half of R4's mechanism. `global.headers.Authorization` is what
 * makes PostgREST apply RLS as this specific user, exactly as
 * `@supabase/ssr`'s cookie-derived client does for a normal browser session;
 * the only difference is where the bearer token came from.
 *
 * Typed `<Database>` deliberately, unlike lib/mcp/tokens.ts's untyped
 * client: this client reads/writes ordinary domain tables (tasks, profiles,
 * ...) that already exist in the generated types, so there is no reason to
 * give up type safety here the way tokens.ts has to for tables migration
 * 130 hasn't been applied/regenerated for yet.
 */
export function buildUserScopedClient(jwt: string): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable.");
  if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable.");

  return createSupabaseClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

/** Test-only escape hatch: lets lib/mcp/__tests__/session.test.ts force a fresh key load after swapping env vars, instead of reusing the process-lifetime cache. Not exported from anywhere a production caller would find it by accident. */
export function __resetSigningKeyCacheForTests(): void {
  cachedMaterial = null;
}
