import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-token rate limiting for MCP tool calls (L3, PROGRAM-PLAN.md).
 *
 * NO REDIS, NO IN-MEMORY STATE — by instruction, and for a concrete reason:
 * a serverless function's memory does not survive between invocations, so
 * an in-memory counter limits nothing on Vercel; the next call is a cold
 * process with a counter back at zero. `mcp_audit_log` is the only state
 * that actually persists between calls, so the limiter counts real rows in
 * it rather than keeping a count of its own anywhere.
 *
 * PER TOKEN, NOT PER USER: `mcp_audit_log_token_id_created_at_idx`
 * (migration 130) exists for exactly this query. A user with several
 * tokens must not have one noisy token exhaust the budget of another --
 * counting by user_id would do that.
 *
 * DEFAULTS BELOW ARE MINE, NOT SPECIFIED — same posture as migration 130's
 * scopes (also mine, documented as such). 30 calls / 60s is a guess at
 * "fast enough for an interactive assistant session, slow enough to bound
 * damage from a runaway loop"; there is no usage data yet to tune it
 * against. Treat as a placeholder the owner/lead should revisit once real
 * MCP traffic exists.
 */
export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const RATE_LIMIT_MAX_CALLS = 30;

export interface RateLimitResult {
  ok: boolean;
  /** Present only when `ok` is false — safe to return to the caller as-is. */
  message?: string;
}

/**
 * Counts this token's `mcp_audit_log` rows in the trailing window. Uses a
 * `head: true, count: "exact"` select so Postgres returns a row count
 * without shipping the rows themselves — this runs on every tool call, so
 * it has to stay cheap.
 *
 * `supabase` MUST be a service-role client (see verifyAccessToken's own
 * comment in lib/mcp/tokens.ts for why an RLS-scoped client can't be used
 * here either — same reasoning: rate-limiting happens before/around the
 * per-user session is minted, and mcp_audit_log grants the user only
 * SELECT, not the aggregate query shape this needs against other users'
 * absence of rows... more simply: this is infrastructure bookkeeping, not
 * a user-facing read, and belongs on the service-role path like the token
 * lookup it sits next to).
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  tokenId: string,
  windowSeconds: number = RATE_LIMIT_WINDOW_SECONDS,
  maxCalls: number = RATE_LIMIT_MAX_CALLS,
): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await supabase
    .from("mcp_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("token_id", tokenId)
    .gte("created_at", windowStart);

  if (error) {
    // Fail CLOSED: if we can't even tell how many calls this token has made
    // recently, we cannot honestly claim the limit is respected. A denial a
    // legitimate caller can retry in a moment is a far smaller cost than a
    // rate limit that silently stops limiting the moment its own query breaks.
    return { ok: false, message: "Rate limit check failed; try again shortly." };
  }

  if ((count ?? 0) >= maxCalls) {
    return { ok: false, message: `Rate limit exceeded: ${maxCalls} calls per ${windowSeconds}s per token.` };
  }
  return { ok: true };
}
