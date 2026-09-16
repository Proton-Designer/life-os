import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientIpFromHeaders, hashRegistrationIp } from "@/lib/mcp/oauth";

/**
 * P3-08: a per-IP cap on the public share-view route
 * (app/share/[token]/page.tsx), reusing the SAME DB-backed bucket
 * lib/mcp/auth-failure-limit.ts uses (`mcp_rate_limit_note_failure`,
 * migration 220) — a different key namespace ("shareview:") and different
 * limit than that file's own `authfail:` bucket, since this is a
 * different abuse case (someone hammering a legitimate public link, not
 * guessing a credential). Reuses `hashRegistrationIp`/`clientIpFromHeaders`
 * from lib/mcp/oauth.ts (not itself in ENG2's do-not-touch list;
 * rate-limit.ts and auth-failure-limit.ts are, and neither is edited
 * here).
 *
 * GENEROUS ON PURPOSE (Opus Lead's explicit condition): drilling itself
 * never re-hits this route — the whole bank is delivered on ONE page load
 * and cycled through client-side with zero further server requests — so
 * this limit only ever governs repeated PAGE LOADS (bookmarking/reopening,
 * several people behind one shared office IP). 300/hour comfortably covers
 * that while still capping a sustained hammering script.
 *
 * FAILS OPEN, same reasoning as the auth-failure limiter: this exists to
 * blunt abuse, not to gate access, so its own breakage (RPC error, no
 * client IP) must never turn into a real visitor's link failing to load.
 */
export const PUBLIC_SHARE_VIEW_LIMIT = 300;
export const PUBLIC_SHARE_VIEW_WINDOW_SECONDS = 3600;

export type PublicShareRateVerdict = { limited: false } | { limited: true; retryAfterSeconds: number };

export async function checkPublicShareViewLimit(serviceClient: SupabaseClient, headers: Headers): Promise<PublicShareRateVerdict> {
  const ipHash = hashRegistrationIp(clientIpFromHeaders(headers));
  if (!ipHash) return { limited: false };

  const { data, error } = await serviceClient.rpc("mcp_rate_limit_note_failure", {
    p_key: `shareview:${ipHash}`,
    p_limit: PUBLIC_SHARE_VIEW_LIMIT,
    p_window_seconds: PUBLIC_SHARE_VIEW_WINDOW_SECONDS,
  });
  const answer = (data ?? null) as { over_limit?: unknown; retry_after_seconds?: unknown } | null;
  if (error || !answer || answer.over_limit !== true) return { limited: false };

  const retryAfterSeconds =
    typeof answer.retry_after_seconds === "number" && answer.retry_after_seconds > 0
      ? Math.ceil(answer.retry_after_seconds)
      : PUBLIC_SHARE_VIEW_WINDOW_SECONDS;

  // Opus Lead's diagnosability requirement: never the raw IP, never the
  // token/token hash -- just enough to confirm "yes, this network was
  // throttled" when a real visitor reports an unexplained 404.
  console.warn("[share-view-rate-limit] throttled", { ipHash, retryAfterSeconds });

  return { limited: true, retryAfterSeconds };
}
