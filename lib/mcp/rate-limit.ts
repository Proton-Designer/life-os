import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Rate limiting for the agent surface -- MCP tool calls, REST /api/v1 calls
 * and scheduled fires -- via ONE atomic RPC, public.mcp_rate_limit_consume
 * (migration 220, P4-14).
 *
 * WHY NOT COUNT mcp_audit_log ROWS ANY MORE (the pre-P4-14 design): that was
 * count-then-act, so a parallel burst all passed before any audit row landed
 * (proven on a real Postgres: 35 of 40 parallel calls got through a 30 limit);
 * denied calls wrote audit rows and so consumed budget; it was per token only;
 * and scheduled fires shared the interactive budget. The RPC takes a per-key
 * advisory lock, checks EVERY key, and increments all of them or none: 40
 * parallel calls allow exactly 30, and a denial costs nothing. Still no
 * in-memory state -- serverless instances don't share memory.
 *
 * BUCKETS PER LANE
 *   interactive (MCP and REST share it): per token AND per user (all tokens)
 *   scheduler: its own per-token and per-user buckets, so a busy interactive
 *              session never makes scheduled writes fail and pause
 *
 * 2026-10-05: raised 30/60 -> 120/240 (interactive only). An assistant's session-start sweep of the read tools
 * is 30+ calls and tripped the old limit in ordinary use; the limit exists to cut off loops and leaked tokens,
 * which 120/min still does. The scheduler lane is unchanged.
 * The per-user ceiling is 2x the per-token limit, so one token alone never
 * trips it first; it exists to stop "mint more tokens" from multiplying the
 * budget.
 *
 * FIXED WINDOWS: up to 2x a limit can land across a window boundary. Accepted
 * (bounding loops and abuse, not metering) -- see migration 220's header.
 */
export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const RATE_LIMIT_MAX_CALLS = 120;
export const RATE_LIMIT_USER_MAX_CALLS = 240;
export const SCHEDULER_RATE_LIMIT_MAX_CALLS = 30;
export const SCHEDULER_RATE_LIMIT_USER_MAX_CALLS = 60;

/** Retry-After used when the limiter itself can't answer (it fails closed). */
const FAIL_CLOSED_RETRY_SECONDS = 5;

export type RateLimitLane = "interactive" | "scheduler";

export interface RateLimitResult {
  ok: boolean;
  /** Present only when `ok` is false -- safe to return to the caller as-is. */
  message?: string;
  /** Present only when `ok` is false: seconds until the window resets (HTTP Retry-After). */
  retryAfterSeconds?: number;
}

export function rateLimitBuckets(lane: RateLimitLane, tokenId: string, userId: string): { keys: string[]; limits: number[] } {
  if (lane === "scheduler") {
    return { keys: [`sched-tok:${tokenId}`, `sched-user:${userId}`], limits: [SCHEDULER_RATE_LIMIT_MAX_CALLS, SCHEDULER_RATE_LIMIT_USER_MAX_CALLS] };
  }
  return { keys: [`tok:${tokenId}`, `user:${userId}`], limits: [RATE_LIMIT_MAX_CALLS, RATE_LIMIT_USER_MAX_CALLS] };
}

/**
 * Consumes one call from every bucket of `lane` for this token and user, or
 * none if any is exhausted. `supabase` MUST be the service-role client
 * (EXECUTE on the RPC is granted to service_role only).
 */
export async function consumeRateLimit(
  supabase: SupabaseClient,
  params: { tokenId: string; userId: string; lane: RateLimitLane },
): Promise<RateLimitResult> {
  const { keys, limits } = rateLimitBuckets(params.lane, params.tokenId, params.userId);
  const { data, error } = await supabase.rpc("mcp_rate_limit_consume", {
    p_keys: keys,
    p_limits: limits,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  });

  const answer = (data ?? null) as { allowed?: unknown; limited_key?: unknown; retry_after_seconds?: unknown } | null;
  if (error || !answer || typeof answer.allowed !== "boolean") {
    // Fail CLOSED: if we can't tell whether this call is within budget, we
    // can't honestly claim the limit holds. A caller can retry in a moment.
    return { ok: false, message: "Rate limit check failed; try again shortly.", retryAfterSeconds: FAIL_CLOSED_RETRY_SECONDS };
  }
  if (answer.allowed) return { ok: true };

  const retryAfterSeconds =
    typeof answer.retry_after_seconds === "number" && answer.retry_after_seconds > 0 ? Math.ceil(answer.retry_after_seconds) : RATE_LIMIT_WINDOW_SECONDS;
  const limitedKey = typeof answer.limited_key === "string" ? answer.limited_key : "";
  const perUser = limitedKey.startsWith("user:") || limitedKey.startsWith("sched-user:");
  const limit = limits[keys.indexOf(limitedKey)] ?? limits[0];
  const scope = perUser ? "across all of this account's tokens" : "per token";
  return {
    ok: false,
    message: `Rate limit exceeded: ${limit} calls per ${RATE_LIMIT_WINDOW_SECONDS}s ${scope}. Retry after ${retryAfterSeconds}s.`,
    retryAfterSeconds,
  };
}
