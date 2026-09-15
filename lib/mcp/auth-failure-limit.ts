import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientIpFromHeaders, hashRegistrationIp } from "./oauth";

/**
 * P4-14: a cheap per-IP limit on FAILED authentication -- a bearer token that
 * was presented and rejected at /api/mcp or /api/v1, or an invalid_grant /
 * unknown client at /api/mcp/oauth/*. Over the limit, the route answers 429 +
 * Retry-After instead of 401/400, so a client (or script) guessing or looping
 * on a dead credential is told to back off.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: block successful requests from that IP.
 * Many users can share one egress IP (a hosted assistant's backend calls every
 * user's connector from the same addresses); refusing good traffic because
 * someone else's token is broken would take everyone down. So the counter is
 * touched only on the failure path, and the happy path pays nothing.
 *
 * "CHEAP": the source of truth is the DB bucket (public.mcp_rate_limit_note_failure,
 * migration 220) so it holds across serverless instances; a warm instance that
 * already saw an IP go over the limit answers from a small in-memory map until
 * that window ends, skipping the RPC.
 *
 * FAILS OPEN, unlike the call limiter: if the RPC errors or there is no client
 * IP, the plain 401/400 is returned. This limit exists to throttle abuse, and
 * its own breakage must not turn into a lockout. (The call-budget limiter in
 * rate-limit.ts fails closed, because over-spend there has real cost.)
 *
 * The IP is never stored: the key is authfail:<HMAC-SHA256(SUPABASE_SERVICE_ROLE_KEY, ip)>,
 * the same keyed hash P4-13's registration limit uses.
 */
export const AUTH_FAILURE_LIMIT = 30;
export const AUTH_FAILURE_WINDOW_SECONDS = 60;

const MAX_CACHED_IPS = 1000;
const blockedUntil = new Map<string, number>();

export type AuthFailureVerdict = { limited: false } | { limited: true; retryAfterSeconds: number };

export async function noteAuthFailure(serviceClient: SupabaseClient, request: Request, now: number = Date.now()): Promise<AuthFailureVerdict> {
  const ipHash = hashRegistrationIp(clientIpFromHeaders(request.headers));
  if (!ipHash) return { limited: false };

  const cachedUntil = blockedUntil.get(ipHash);
  if (cachedUntil !== undefined) {
    if (cachedUntil > now) return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((cachedUntil - now) / 1000)) };
    blockedUntil.delete(ipHash);
  }

  const { data, error } = await serviceClient.rpc("mcp_rate_limit_note_failure", {
    p_key: `authfail:${ipHash}`,
    p_limit: AUTH_FAILURE_LIMIT,
    p_window_seconds: AUTH_FAILURE_WINDOW_SECONDS,
  });
  const answer = (data ?? null) as { over_limit?: unknown; retry_after_seconds?: unknown } | null;
  if (error || !answer || answer.over_limit !== true) return { limited: false };

  const retryAfterSeconds =
    typeof answer.retry_after_seconds === "number" && answer.retry_after_seconds > 0 ? Math.ceil(answer.retry_after_seconds) : AUTH_FAILURE_WINDOW_SECONDS;
  if (blockedUntil.size >= MAX_CACHED_IPS) blockedUntil.clear();
  blockedUntil.set(ipHash, now + retryAfterSeconds * 1000);
  return { limited: true, retryAfterSeconds };
}

/** The 429 a route returns in place of its 401/400 once an IP is over the auth-failure limit. */
export function tooManyAuthFailuresResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      error_description: `Too many failed authentication attempts from this network. Retry after ${retryAfterSeconds}s.`,
    }),
    { status: 429, headers: { "content-type": "application/json", "retry-after": String(retryAfterSeconds) } },
  );
}

export function __resetAuthFailureCacheForTests(): void {
  blockedUntil.clear();
}
