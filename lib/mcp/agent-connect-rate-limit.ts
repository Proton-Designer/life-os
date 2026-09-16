import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientIpFromHeaders, hashRegistrationIp } from "@/lib/mcp/oauth";

/**
 * P4-21 (Opus Lead ruling): a per-IP cap on `/connect/[code]`, reusing the
 * SAME DB-backed bucket `lib/mcp/auth-failure-limit.ts`/
 * `lib/school/public-share-rate-limit.ts` already use
 * (`mcp_rate_limit_note_failure`, migration 220) — its own key namespace
 * ("connect:") and its own limit, since this is a different case from
 * both: unlike a public share view, a successful hit here MINTS a real
 * credential (a side effect worth capping); unlike an auth-failure guess,
 * the code itself is 256 bits of entropy, so this exists to blunt
 * scripted hammering, not to meaningfully resist brute force (that's
 * already computationally infeasible regardless of any rate limit).
 * Reuses `hashRegistrationIp`/`clientIpFromHeaders` from lib/mcp/oauth.ts
 * (not itself in ENG2's do-not-touch list; rate-limit.ts and
 * auth-failure-limit.ts are, and neither is edited here).
 *
 * 20/hour/IP: generous enough that a real user opening (or retrying) their
 * own link once never trips it, tight enough to cap a scripted hammer.
 *
 * FAILS OPEN, same reasoning as every other limiter in this codebase: this
 * exists to blunt abuse, not to gate access, so its own breakage (RPC
 * error, no client IP) must never turn into a real agent's connect
 * attempt failing.
 */
export const AGENT_CONNECT_LIMIT = 20;
export const AGENT_CONNECT_WINDOW_SECONDS = 3600;

export type AgentConnectRateVerdict = { limited: false } | { limited: true; retryAfterSeconds: number };

export async function checkAgentConnectLimit(serviceClient: SupabaseClient, headers: Headers): Promise<AgentConnectRateVerdict> {
  const ipHash = hashRegistrationIp(clientIpFromHeaders(headers));
  if (!ipHash) return { limited: false };

  const { data, error } = await serviceClient.rpc("mcp_rate_limit_note_failure", {
    p_key: `connect:${ipHash}`,
    p_limit: AGENT_CONNECT_LIMIT,
    p_window_seconds: AGENT_CONNECT_WINDOW_SECONDS,
  });
  const answer = (data ?? null) as { over_limit?: unknown; retry_after_seconds?: unknown } | null;
  if (error || !answer || answer.over_limit !== true) return { limited: false };

  const retryAfterSeconds =
    typeof answer.retry_after_seconds === "number" && answer.retry_after_seconds > 0 ? Math.ceil(answer.retry_after_seconds) : AGENT_CONNECT_WINDOW_SECONDS;

  // Diagnosability, same posture as public-share-rate-limit.ts: never the
  // raw IP, never the code/code hash -- just enough to confirm "yes, this
  // network was throttled" when a real user reports an unexplained failure.
  console.warn("[agent-connect-rate-limit] throttled", { ipHash, retryAfterSeconds });

  return { limited: true, retryAfterSeconds };
}
