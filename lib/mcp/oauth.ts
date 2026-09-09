import "server-only";
import { randomBytes, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqualStrings, isMcpScope, type McpScope } from "./tokens";

/**
 * L4 (docs/ai-connector/PROGRAM-PLAN.md): the hand-rolled OAuth 2.1
 * authorization server that satisfies Claude's (and, per verification,
 * ChatGPT's and Gemini's) custom-connector UI — none of the three accept a
 * pasted bearer token (R1). This module holds every piece of protocol logic
 * that is security-critical: PKCE, single-use codes, client validation,
 * refresh-token rotation with reuse detection. Route handlers under
 * app/api/mcp/oauth/* are thin — they parse the HTTP request, call in here,
 * and shape the response. Keeping the logic here, not spread across three
 * route files, is what makes it auditable as one thing.
 *
 * UNTYPED `SupabaseClient` throughout, same reason as lib/mcp/tokens.ts: the
 * tables this file reads/writes (mcp_oauth_clients, mcp_oauth_codes,
 * mcp_oauth_refresh_tokens) are a NEW migration, not yet applied/regenerated
 * into database.types.ts at the time this is written — see
 * apply-migration.sh's own rule against hand-typing tables that don't exist
 * in the real database yet. A `Database`-typed client (e.g. from
 * createServiceRoleClient()) is still assignable here; this file just never
 * asserts more than the real, applied schema can back up.
 *
 * WHO CALLS THIS WITH WHICH CLIENT — the same session/no-session asymmetry
 * lib/mcp/tokens.ts already established, extended to three more tables:
 * - registerOAuthClient / getOAuthClient: SERVICE-ROLE always. Client
 *   registration (DCR) happens before any user is involved at all — there is
 *   no session to scope through — and looking a client up at /authorize or
 *   /token is the same: mcp_oauth_clients carries no RLS policies at all
 *   (deny-all by construction, same shape DATA-INVENTORY.md found already
 *   correct for this program's two truly-operational tables).
 * - mintAuthorizationCode: the CALLER'S OWN per-request client (from
 *   requireUser()), because /authorize is the one step in this whole flow
 *   where a real, cookie-authenticated Life OS session exists. The code row
 *   is genuinely user-owned data and mcp_oauth_codes' RLS policies reflect
 *   that (own-row select/insert, same shape as mcp_access_tokens).
 * - consumeAuthorizationCode, mintRefreshToken, rotateRefreshToken:
 *   SERVICE-ROLE always. /token is a server-to-server POST with a bearer
 *   credential in the body, never a cookie — there is no session to scope
 *   through, the same reason verifyAccessToken (lib/mcp/tokens.ts) needs
 *   service-role for its anonymous-token lookup.
 */

const CODE_PREFIX = "lifeos_oauthcode_";
const REFRESH_PREFIX = "lifeos_oauthrefresh_";
const CLIENT_ID_PREFIX = "lifeos_client_";

/** Generous enough to survive a real redirect round-trip; short enough that a leaked code is worthless within minutes. */
export const AUTH_CODE_TTL_SECONDS = 120;

/**
 * A hard ceiling on how many clients DCR will ever register, independent of
 * any rate limiter (there isn't one here — L3 owns per-token rate limiting
 * for tool calls, per PROGRAM-PLAN; this is a much cruder, cheaper guard
 * against a runaway registration loop filling the table, not an attacker
 * -grade defense). 50 is far more than "three known platforms plus some
 * slack for re-registration during testing" ever needs.
 */
export const MAX_REGISTERED_CLIENTS = 50;

function randomToken(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * RFC 7636 S256: base64url(sha256(code_verifier)) compared to the
 * code_challenge recorded at /authorize time. Constant-time compare
 * (`timingSafeEqualStrings`, imported from lib/mcp/tokens.ts — not
 * reimplemented) because a code_challenge is effectively a stored secret
 *-adjacent value for the lifetime of the code.
 */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  const computed = createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
  return timingSafeEqualStrings(computed, codeChallenge);
}

/**
 * RFC 8252 sec 7.3's loopback exception aside, every redirect_uri this
 * server will ever accept is `https://`. Claude/ChatGPT/Gemini's own
 * documented callback hosts are all https (see PROGRAM-PLAN's sources); the
 * loopback allowance exists only so a local manual test (`curl`/a script
 * against this route during development) isn't forced to stand up TLS.
 */
export function isValidRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol === "http:") {
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]" || parsed.hostname === "::1";
  }
  return false;
}

/**
 * Parses an OAuth `scope` request param (space-separated, RFC 6749 sec 3.3)
 * into our own McpScope vocabulary. Returns `null` for a request naming a
 * scope this server doesn't have — never silently drops the unknown one and
 * grants a narrower set than what was asked for, which would look like
 * success while quietly under-provisioning. Returns an empty array (not
 * `null`) for an empty/omitted param — deciding what "no scope requested"
 * defaults to is the caller's policy choice, not this function's.
 */
export function parseScopeParam(scopeParam: string | null | undefined): McpScope[] | null {
  if (!scopeParam || scopeParam.trim().length === 0) return [];
  const parts = scopeParam.trim().split(/\s+/);
  const scopes: McpScope[] = [];
  for (const part of parts) {
    if (!isMcpScope(part)) return null;
    if (!scopes.includes(part)) scopes.push(part);
  }
  return scopes;
}

export interface OAuthClientRegistrationInput {
  redirect_uris?: unknown;
  client_name?: unknown;
  token_endpoint_auth_method?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
}

export interface OAuthClientMetadata {
  client_id: string;
  client_id_issued_at: number;
  client_name: string | null;
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  grant_types: ["authorization_code", "refresh_token"];
  response_types: ["code"];
}

/**
 * Validates a raw RFC 7591 registration request. Deliberately narrow: this
 * server supports exactly one client shape — a public client (no secret)
 * doing authorization_code + PKCE. A request naming `client_secret_post` or
 * similar for `token_endpoint_auth_method` is not an error — RFC 7591
 * permits (and MCP clients in practice tolerate) a server normalizing fields
 * it doesn't support, so this silently overrides to `"none"` rather than
 * rejecting a real client's registration attempt over a field neither Claude
 * nor ChatGPT nor Gemini choose for us.
 */
export function validateClientRegistration(
  input: OAuthClientRegistrationInput
): { ok: true; redirectUris: string[]; clientName: string | null } | { ok: false; message: string } {
  const redirectUris = input.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return { ok: false, message: "redirect_uris must be a non-empty array." };
  }
  if (redirectUris.length > 10) {
    return { ok: false, message: "Too many redirect_uris (max 10)." };
  }
  const normalized: string[] = [];
  for (const uri of redirectUris) {
    if (typeof uri !== "string" || !isValidRedirectUri(uri)) {
      return { ok: false, message: `Invalid redirect_uri: ${String(uri)}` };
    }
    normalized.push(uri);
  }
  const clientNameRaw = input.client_name;
  const clientName =
    typeof clientNameRaw === "string" && clientNameRaw.trim().length > 0
      ? clientNameRaw.trim().slice(0, 200)
      : null;
  return { ok: true, redirectUris: normalized, clientName };
}

interface OAuthClientRow {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  created_at: string;
}

/**
 * RFC 7591 Dynamic Client Registration. SERVICE-ROLE — see the file header.
 * Unauthenticated by design: this is the one endpoint in the whole MCP
 * surface any stranger on the internet can call, which is why validation
 * here is deliberately strict (exact redirect_uri scheme rules, a hard
 * client-count ceiling) even though registering a client, on its own, grants
 * no access to anything — see app/api/mcp/oauth/authorize/route.ts's
 * mandatory consent step for why that is true, and why it must stay true.
 */
export async function registerOAuthClient(
  supabase: SupabaseClient,
  input: OAuthClientRegistrationInput
): Promise<{ ok: true; client: OAuthClientMetadata } | { ok: false; status: number; error: string; message: string }> {
  const validated = validateClientRegistration(input);
  if (!validated.ok) {
    return { ok: false, status: 400, error: "invalid_client_metadata", message: validated.message };
  }

  const { count } = await supabase
    .from("mcp_oauth_clients")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_REGISTERED_CLIENTS) {
    return {
      ok: false,
      status: 429,
      error: "temporarily_unavailable",
      message: "Registration limit reached. Ask the Life OS owner to review registered clients.",
    };
  }

  const clientId = randomToken(CLIENT_ID_PREFIX);
  const { data, error } = await supabase
    .from("mcp_oauth_clients")
    .insert({ client_id: clientId, client_name: validated.clientName, redirect_uris: validated.redirectUris })
    .select("client_id, client_name, redirect_uris, created_at")
    .single();
  if (error || !data) {
    return { ok: false, status: 500, error: "server_error", message: "Couldn't register the client. Try again." };
  }

  const row = data as OAuthClientRow;
  return {
    ok: true,
    client: {
      client_id: row.client_id,
      client_id_issued_at: Math.floor(new Date(row.created_at).getTime() / 1000),
      client_name: row.client_name,
      redirect_uris: row.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  };
}

/** SERVICE-ROLE — see the file header. Returns null for an unknown client_id, never throws. */
export async function getOAuthClient(supabase: SupabaseClient, clientId: string): Promise<OAuthClientRow | null> {
  const { data, error } = await supabase
    .from("mcp_oauth_clients")
    .select("client_id, client_name, redirect_uris, created_at")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !data) return null;
  return data as OAuthClientRow;
}

export interface MintCodeParams {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource?: string | null;
  scopes: McpScope[];
}

/**
 * Mints a single-use authorization code. Called from the CALLER'S OWN
 * per-request client (requireUser()) — see the file header. Validates
 * `codeChallengeMethod` here, not just at consumption: OAuth 2.1 requires
 * PKCE, and "plain" is a real, still-sometimes-implemented downgrade this
 * server refuses outright rather than accepting and hoping nobody asks for
 * it — accepting "plain" here would mean a code_challenge that's just the
 * verifier itself, sent in the clear over the (browser-visible) redirect
 * chain, defeating the entire point of PKCE.
 */
export async function mintAuthorizationCode(
  supabase: SupabaseClient,
  params: MintCodeParams
): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
  if (params.codeChallengeMethod !== "S256") {
    return { ok: false, message: `Unsupported code_challenge_method: "${params.codeChallengeMethod}". Only S256 is accepted.` };
  }
  if (!params.codeChallenge) {
    return { ok: false, message: "code_challenge is required." };
  }
  if (params.scopes.length === 0) {
    return { ok: false, message: "At least one scope is required." };
  }

  const rawCode = randomToken(CODE_PREFIX);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000).toISOString();

  const { error } = await supabase.from("mcp_oauth_codes").insert({
    code_hash: sha256Hex(rawCode),
    client_id: params.clientId,
    user_id: params.userId,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: params.codeChallengeMethod,
    resource: params.resource ?? null,
    scopes: params.scopes,
  });
  if (error) return { ok: false, message: "Couldn't issue an authorization code. Try again." };

  return { ok: true, code: rawCode };
}

interface OAuthCodeRow {
  id: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string | null;
  scopes: string[];
  expires_at: string;
  used_at: string | null;
}

export interface ConsumeCodeParams {
  rawCode: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}

export type ConsumeCodeResult =
  | { ok: true; userId: string; scopes: McpScope[]; resource: string | null }
  | { ok: false; error: "invalid_grant" | "invalid_request"; message: string };

/**
 * Redeems an authorization code. SERVICE-ROLE — see the file header.
 *
 * SINGLE-USE IS ENFORCED BY THE UPDATE ITSELF, NOT BY A CHECK-THEN-WRITE.
 * `UPDATE ... WHERE used_at IS NULL` is the entire mechanism: two concurrent
 * redemption attempts for the same code race at the database, and at most
 * one `UPDATE` can match a still-NULL `used_at` — the loser gets zero rows
 * back and is treated as "already used," exactly as it should be. A
 * SELECT-to-check-unused followed by a separate UPDATE would have a real
 * window between the two statements where both requests could see
 * "unused" and both proceed — RFC 6749 sec 10.5 requires a code to be
 * single-use for exactly this reason (a leaked/duplicated code must not
 * silently mint two valid sessions).
 */
export async function consumeAuthorizationCode(
  supabase: SupabaseClient,
  params: ConsumeCodeParams
): Promise<ConsumeCodeResult> {
  const hash = sha256Hex(params.rawCode);
  const { data, error } = await supabase
    .from("mcp_oauth_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code_hash", hash)
    .is("used_at", null)
    .select("id, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, resource, scopes, expires_at, used_at")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "invalid_grant", message: "Authorization code is invalid, already used, or expired." };
  }

  const row = data as OAuthCodeRow;

  // Every check below runs AFTER the code is already marked used — a code
  // that fails one of these checks is spent either way (an attacker probing
  // client_id/redirect_uri/verifier combinations against a real code gets
  // exactly one guess, not unlimited attempts against a code that stays
  // "live" until they guess right).
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "invalid_grant", message: "Authorization code has expired." };
  }
  if (!timingSafeEqualStrings(row.client_id, params.clientId)) {
    return { ok: false, error: "invalid_grant", message: "client_id does not match the code's issuer." };
  }
  if (row.redirect_uri !== params.redirectUri) {
    return { ok: false, error: "invalid_grant", message: "redirect_uri does not match the one used at authorization." };
  }
  if (!verifyPkce(params.codeVerifier, row.code_challenge)) {
    return { ok: false, error: "invalid_grant", message: "PKCE verification failed." };
  }

  return {
    ok: true,
    userId: row.user_id,
    scopes: row.scopes.filter(isMcpScope),
    resource: row.resource,
  };
}

interface RefreshTokenRow {
  id: string;
  access_token_id: string;
  client_id: string;
  user_id: string;
  rotated_at: string | null;
}

/**
 * Mints a refresh token alongside a freshly-issued access token. SERVICE
 * -ROLE — see the file header. Access tokens minted through this OAuth path
 * do not carry a clock-based expiry (they are `mcp_access_tokens` rows —
 * the SAME table and shape L2's Settings-issued PATs use, per the explicit
 * instruction not to invent a parallel credential; that table has no
 * `expires_at` column, and this design does not add one — see this
 * function's caller in app/api/mcp/oauth/token/route.ts for the reasoning).
 * The refresh token still earns its place: rotation-with-reuse-detection
 * (`rotateRefreshToken` below) is a theft SIGNAL independent of whether the
 * access token it guards has a ticking clock.
 */
export async function mintRefreshToken(
  supabase: SupabaseClient,
  params: { accessTokenId: string; clientId: string; userId: string }
): Promise<{ ok: true; refreshToken: string } | { ok: false; message: string }> {
  const rawRefreshToken = randomToken(REFRESH_PREFIX);
  const { error } = await supabase.from("mcp_oauth_refresh_tokens").insert({
    token_hash: sha256Hex(rawRefreshToken),
    access_token_id: params.accessTokenId,
    client_id: params.clientId,
    user_id: params.userId,
  });
  if (error) return { ok: false, message: "Couldn't issue a refresh token. Try again." };
  return { ok: true, refreshToken: rawRefreshToken };
}

export type RotateRefreshTokenResult =
  | { ok: true; userId: string; clientId: string; oldAccessTokenId: string }
  | { ok: false; error: "invalid_grant"; message: string; reuseDetected: boolean };

/**
 * Redeems (rotates) a refresh token. SERVICE-ROLE — see the file header.
 *
 * REUSE DETECTION, THE OAUTH 2.1-RECOMMENDED MITIGATION FOR A STOLEN REFRESH
 * TOKEN: a refresh token is single-use, exactly like an authorization code
 * (same atomic `UPDATE ... WHERE rotated_at IS NULL` pattern, same reasoning
 * — see consumeAuthorizationCode's comment). The difference here is what
 * happens on a SECOND redemption attempt for an already-rotated token: that
 * is not "expired," it is the signature of a token that exists in two
 * places (a legitimate client that already rotated, AND whoever replayed
 * the old value) — which happens if and only if the refresh token was
 * copied by someone other than its rightful holder.
 *
 * WHAT GETS REVOKED, STATED PRECISELY (corrected during the L4 flow
 * verification — an earlier version of this comment overclaimed "revokes
 * the entire token family"): this function only identifies THAT reuse
 * happened; it does not, on its own, know which access token is currently
 * live. The row being replayed already has its OWN `access_token_id`, but in
 * the straightforward case (a client innocently replays a token it already
 * rotated away from) that access token is already dead — revoking it again
 * is a no-op, not new protection. The scenario that actually matters is an
 * ATTACKER who redeems the stolen refresh token FIRST: that redemption looks
 * like an ordinary, successful rotation at the time, and produces a live
 * access token the attacker holds. The legitimate holder's LATER replay of
 * the original token is what surfaces here as reuse — and closing that gap
 * means also finding and revoking whatever access token is CURRENTLY live
 * for this (user, client) pair, not just the stale row's own one. See
 * `findLiveAccessTokenIdsForClient` below and its caller
 * (app/api/mcp/oauth/token/route.ts) for that second half.
 */
export async function rotateRefreshToken(
  supabase: SupabaseClient,
  rawRefreshToken: string
): Promise<RotateRefreshTokenResult> {
  const hash = sha256Hex(rawRefreshToken);

  // Look up first (read-only) to distinguish "never existed" from "already
  // rotated" — the atomic UPDATE below only fires the reuse-detection path
  // when we can tell these apart.
  const { data: existing } = await supabase
    .from("mcp_oauth_refresh_tokens")
    .select("id, access_token_id, client_id, user_id, rotated_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!existing) {
    return { ok: false, error: "invalid_grant", message: "Refresh token is invalid.", reuseDetected: false };
  }

  const existingRow = existing as RefreshTokenRow;

  if (existingRow.rotated_at) {
    // Reuse of an already-rotated token. The caller revokes
    // existingRow.access_token_id; returning it here would require exposing
    // it through the ok:false branch, which the type deliberately doesn't
    // do — reuse is signalled by the flag alone, and the caller re-reads
    // the row it already has (it's the one that called this function with
    // the raw token in the first place) to know which access token to kill.
    return {
      ok: false,
      error: "invalid_grant",
      message: "Refresh token has already been used. The associated access has been revoked.",
      reuseDetected: true,
    };
  }

  const { data: rotated, error } = await supabase
    .from("mcp_oauth_refresh_tokens")
    .update({ rotated_at: new Date().toISOString() })
    .eq("token_hash", hash)
    .is("rotated_at", null)
    .select("id, access_token_id, client_id, user_id")
    .maybeSingle();

  if (error || !rotated) {
    // Lost the race against a concurrent redemption of the SAME token —
    // treat it the same as reuse, since that is exactly what it is.
    return {
      ok: false,
      error: "invalid_grant",
      message: "Refresh token has already been used.",
      reuseDetected: true,
    };
  }

  const row = rotated as { id: string; access_token_id: string; client_id: string; user_id: string };
  return { ok: true, userId: row.user_id, clientId: row.client_id, oldAccessTokenId: row.access_token_id };
}

/**
 * Looks up the {access_token_id, user_id, client_id} for a refresh token
 * (used or not), so the caller can revoke the right row on reuse detection
 * AND look up the client's current live descendant (see
 * findLiveAccessTokenIdsForClient below). Deliberately separate from
 * rotateRefreshToken's reuse branch (which does not return this) so the
 * "detect reuse" and "find what to revoke" concerns stay independently
 * readable — see app/api/mcp/oauth/token/route.ts for how they're used
 * together. All fields come off `mcp_oauth_refresh_tokens` itself, not a
 * second join against `mcp_access_tokens`, since the FK IS the binding — no
 * separate cross-check needed.
 */
export async function findAccessTokenForRefreshToken(
  supabase: SupabaseClient,
  rawRefreshToken: string
): Promise<{ accessTokenId: string; userId: string; clientId: string } | null> {
  const hash = sha256Hex(rawRefreshToken);
  const { data } = await supabase
    .from("mcp_oauth_refresh_tokens")
    .select("access_token_id, user_id, client_id")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!data) return null;
  const row = data as { access_token_id: string; user_id: string; client_id: string };
  return { accessTokenId: row.access_token_id, userId: row.user_id, clientId: row.client_id };
}

/**
 * Finds the access_token_id(s) linked to the CURRENT (not-yet-rotated)
 * refresh token row(s) for a given (user, client) pair — the live
 * descendant of a rotation chain, and the actual target reuse detection
 * needs to revoke (see rotateRefreshToken's doc comment above for why the
 * stale row's own access_token_id usually isn't enough on its own).
 *
 * Returns an ARRAY, not a single id: this schema has no explicit
 * one-live-row-per-client invariant enforced at the database level, so if
 * more than one happens to be live (a rare double-connect), the correct
 * response to a suspected-theft signal is to revoke all of them —
 * "when in doubt, revoke broadly," not "guess which one."
 */
export async function findLiveAccessTokenIdsForClient(supabase: SupabaseClient, userId: string, clientId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("mcp_oauth_refresh_tokens")
    .select("access_token_id")
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .is("rotated_at", null);
  if (error || !data) return [];
  return (data as { access_token_id: string }[]).map((r) => r.access_token_id);
}
