import "server-only";
import { SignJWT, importJWK, type JWK } from "jose";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * R4 (PROGRAM-PLAN.md): the locally-signed ES256 session JWT, minted per MCP
 * request with ZERO Auth-server round trips — the mirror image of the local
 * ES256 *verify* `getClaims()` already does (lib/supabase/auth.ts:10-13).
 *
 * THE ONE-TIME SETUP THIS DEPENDS ON (R4b, Ayman's to perform, not code):
 * generate an ES256 keypair (`supabase gen signing-key --algorithm ES256`),
 * import the PUBLIC half into the project's JWT Signing Keys, keep the
 * PRIVATE half as `MCP_SIGNING_KEY_JWK` (a JSON-stringified private JWK) in
 * server secrets. Until that import happens, minting still works (it's pure
 * local signing) but Supabase will reject the resulting JWT at the RLS
 * boundary, because the public half isn't in its JWKS yet — an end-to-end
 * RLS round trip failing for that reason alone is expected, not a bug here.
 *
 * KID must match exactly what was (or will be) imported on the Supabase
 * side — it's how Supabase's JWKS-based verification picks the right public
 * key to check against, the same way `lib/supabase/auth.ts`'s own ES256
 * verification does for Supabase's own key.
 */
const KID = "ff83fd87-4fbf-4ff4-9aae-f609538947e8";
const ALG = "ES256";
const SESSION_TTL_SECONDS = 5 * 60; // short-lived by design — Supabase's own signing-keys docs: "prefer shorter-lived tokens"

let cachedKey: Awaited<ReturnType<typeof importJWK>> | null = null;

/** Loads the private signing key from MCP_SIGNING_KEY_JWK, a JSON-stringified private ES256 JWK. Memoized for the life of the process — it's a pure function of an env var, not of any request. */
async function signingKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.MCP_SIGNING_KEY_JWK;
  if (!raw) {
    throw new Error(
      "MCP_SIGNING_KEY_JWK is not set. The MCP connector cannot mint sessions until the " +
        "one-time ES256 keypair setup (R4b, docs/ai-connector/PROGRAM-PLAN.md) is done.",
    );
  }
  let jwk: JWK;
  try {
    jwk = JSON.parse(raw) as JWK;
  } catch {
    throw new Error("MCP_SIGNING_KEY_JWK is not valid JSON.");
  }
  cachedKey = await importJWK(normalizeForSigning(jwk), ALG);
  return cachedKey;
}

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
 * rather than left as a bare `delete`.
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
  const key = await signingKey();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: ALG, kid: KID })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(key);
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

/** Test-only escape hatch: lets lib/mcp/__tests__/session.test.ts force a fresh key load after swapping MCP_SIGNING_KEY_JWK, instead of reusing the process-lifetime cache. Not exported from anywhere a production caller would find it by accident. */
export function __resetSigningKeyCacheForTests(): void {
  cachedKey = null;
}
