import "server-only";
import { randomBytes, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MCP personal-access tokens (PATs) — generation, hashing, scope checks, and
 * the CRUD/verification queries against `mcp_access_tokens`
 * (supabase/migrations/130_mcp_access.sql).
 *
 * UNTYPED `SupabaseClient` ON PURPOSE, same as lib/ai/resolve-key.ts: this
 * module is used both by the Settings actions (which have a `Database`-typed
 * client from requireUser(), assignable here without a cast) and by L3's
 * future MCP route (which will not). Typing against the generated
 * `Database` would also be a lie until migration 130 is applied and the
 * types regenerated — see apply-migration.sh's own rule against hand-typing
 * tables that don't exist in the real database yet.
 *
 * HASHED, NOT ENCRYPTED. Unlike lib/ai/encryption.ts's DeepSeek keys (which
 * the app must hand back in plaintext to a third party), nothing downstream
 * of issuing a PAT ever needs the raw value again — only a match/no-match
 * verdict. sha256 has no decrypt path, which is the point: there must never
 * be a way to recover a token's plaintext from this table, even for us.
 */

export const MCP_SCOPES = ["read", "write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export interface McpTokenStatus {
  id: string;
  label: string | null;
  last4: string;
  scopes: McpScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const TOKEN_PREFIX = "lifeos_pat_";

/**
 * The prefix is deliberate (per the task brief): it makes a leaked credential
 * greppable in logs/diffs and recognisable to secret-scanners that match on
 * known prefixes, the same reason GitHub/Stripe/etc. prefix their own tokens.
 */
export function generateRawToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/** sha256, hex. One-way — see the file header. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Never store or display more than this — same rule as lib/ai/encryption.ts's last4. */
export function last4(rawToken: string): string {
  return rawToken.slice(-4);
}

/**
 * Constant-time string comparison — COPIED from app/api/cron/ping/route.ts's
 * `timingSafeEqual`, not reimplemented, per the task brief ("it already does
 * this correctly"). Used as the final match check in `verifyAccessToken`
 * below, after the DB has already found a candidate row by indexed hash
 * equality. That index lookup is not itself a timing hazard — sha256(token)
 * is a one-way hash of 256 random bits, not a secret being compared byte by
 * byte — but this is the check that keeps it true even if a future caller
 * ever loosens the lookup (e.g. to a prefix scan), which is exactly the kind
 * of change that would reintroduce the hazard silently.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Shape validation for a scopes array before it ever reaches the DB's own
 * `check` constraint (supabase/migrations/130_mcp_access.sql) — same
 * "reject early with a sentence a user can act on" posture as
 * lib/ai/providers.ts's validateKeyShape. Non-empty is required: a token
 * with no scopes is issuable but useless, and a useless-looking "it's
 * connected" state is exactly the silent-absence failure this codebase keeps
 * finding (see lib/ai/providers.ts's own comment history).
 */
export function validateScopes(scopes: string[]): string | null {
  if (scopes.length === 0) return "Pick at least one permission.";
  for (const s of scopes) {
    if (!isMcpScope(s)) return `Unknown permission: "${s}".`;
  }
  return null;
}

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

/** Does this token carry the permission a tool call needs? */
export function tokenHasScope(scopes: McpScope[], required: McpScope): boolean {
  return scopes.includes(required);
}

interface TokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  token_last4: string;
  label: string | null;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function toStatus(row: TokenRow): McpTokenStatus {
  return {
    id: row.id,
    label: row.label,
    last4: row.token_last4,
    scopes: row.scopes.filter(isMcpScope),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export interface CreateTokenResult {
  ok: boolean;
  message: string;
  /** Present only on success. The ONLY time the raw token exists outside this function's own stack frame. */
  token?: string;
  status?: McpTokenStatus;
}

/**
 * Mints and stores a new PAT. The raw token is returned exactly once, here —
 * no function in this module ever reads one back out of the database, by
 * construction (there is no column to read it from).
 */
export async function createAccessToken(
  supabase: SupabaseClient,
  userId: string,
  label: string | undefined,
  scopes: McpScope[],
): Promise<CreateTokenResult> {
  const scopeError = validateScopes(scopes);
  if (scopeError) return { ok: false, message: scopeError };

  const rawToken = generateRawToken();
  const { data, error } = await supabase
    .from("mcp_access_tokens")
    .insert({
      user_id: userId,
      token_hash: hashToken(rawToken),
      token_last4: last4(rawToken),
      label: label?.trim() || null,
      scopes,
    })
    .select("id, user_id, token_hash, token_last4, label, scopes, created_at, last_used_at, revoked_at")
    .single();
  if (error || !data) return { ok: false, message: "Couldn't create a token. Try again." };

  return { ok: true, message: "Token created.", token: rawToken, status: toStatus(data as TokenRow) };
}

/** Every token this user has ever created, revoked ones included — see migration 130's header on why revoked rows stay listed. */
export async function listAccessTokens(supabase: SupabaseClient, userId: string): Promise<McpTokenStatus[]> {
  const { data, error } = await supabase
    .from("mcp_access_tokens")
    .select("id, user_id, token_hash, token_last4, label, scopes, created_at, last_used_at, revoked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as TokenRow[]).map(toStatus);
}

export interface RevokeResult {
  ok: boolean;
  message: string;
}

/** Idempotent: revoking an already-revoked (or nonexistent/not-yours) token is not an error. */
export async function revokeAccessToken(supabase: SupabaseClient, userId: string, tokenId: string): Promise<RevokeResult> {
  const { error } = await supabase
    .from("mcp_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) return { ok: false, message: "Couldn't revoke that token. Try again." };
  return { ok: true, message: "Token revoked." };
}

export interface VerifiedToken {
  userId: string;
  tokenId: string;
  scopes: McpScope[];
}

/**
 * Read-only check: does this raw token identify a live (non-revoked) row,
 * and — if a scope was required — does that row carry it? Never writes
 * `last_used_at`; that is `touchLastUsed` below, called separately by
 * whoever actually completes the request, so a verification alone (e.g. a
 * failed downstream call, or code that double-checks before acting) doesn't
 * misrepresent "looked at" as "used".
 *
 * R4a (PROGRAM-PLAN.md): this function is what a future MCP route (L3) will
 * call to decide who a bearer token belongs to before minting the locally-
 * signed ES256 session JWT for that user. A deliberately SEPARATE, explicit
 * step — not done here — must confirm that `auth.users` row is still real
 * and active, since this lookup bypasses GoTrue entirely and GoTrue's own
 * banned/deleted checks never run on this path.
 */
export async function verifyAccessToken(
  supabase: SupabaseClient,
  rawToken: string,
  requiredScope?: McpScope,
): Promise<VerifiedToken | null> {
  const hash = hashToken(rawToken);
  const { data, error } = await supabase
    .from("mcp_access_tokens")
    .select("id, user_id, token_hash, token_last4, label, scopes, created_at, last_used_at, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as TokenRow;
  // Belt-and-suspenders re-check of the exact value the query already
  // filtered on — see timingSafeEqualStrings's own comment for why this
  // guards future callers, not today's query.
  if (!timingSafeEqualStrings(hash, row.token_hash)) return null;
  if (row.revoked_at) return null;

  const scopes = row.scopes.filter(isMcpScope);
  if (requiredScope && !tokenHasScope(scopes, requiredScope)) return null;

  return { userId: row.user_id, tokenId: row.id, scopes };
}

/** Records that a verified token was actually used. Best-effort — a failure here must never fail the request it's recording. */
export async function touchLastUsed(supabase: SupabaseClient, tokenId: string): Promise<void> {
  await supabase.from("mcp_access_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tokenId);
}
