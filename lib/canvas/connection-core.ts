import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/ai/encryption";

/**
 * P2-21 — extracted from app/(app)/settings/canvas-actions.ts's own
 * (previously private) `resolveStoredConnection`, verbatim, so BOTH the
 * cookie-authed "Sync courses" Server Action AND the new Canvas cron sync
 * (lib/canvas/sync-core.ts), which loops over many users with a
 * service-role client and no session, share the exact same decrypt step —
 * R5 extraction, same reasoning every other domain's core got extracted
 * for tonight.
 *
 * Returns `null` for "no connection at all" (a genuinely unconnected
 * account, not an error) — decrypt failure THROWS (never returned as
 * null), so a caller can distinguish "nothing to sync" from "something is
 * stored but unreadable" (a stale API_KEY_ENCRYPTION_SECRET after
 * rotation) and react differently, exactly the distinction P2-22's own
 * `refreshCanvasCourses` already makes (decrypt-throw → token_status:
 * 'expired'; no connection → a plain "connect first" message; both are
 * fundamentally different outcomes, not variations of the same "null"
 * value collapsing them together would produce).
 */
export async function resolveCanvasConnectionCore(supabase: SupabaseClient, userId: string): Promise<{ instanceUrl: string; token: string } | null> {
  const { data } = await supabase.from("canvas_connections").select("instance_url, encrypted_token").eq("user_id", userId).maybeSingle();
  // CANVAS-GAP-06 (migration 208): instance_url/encrypted_token are now
  // nullable -- a row can exist for an ICS-feed-only connection with no
  // token at all. This function's contract is "a usable Canvas API
  // connection," and a token-less row is exactly as unusable as no row,
  // so both return null the same way -- never call decryptSecret(null).
  if (!data || data.instance_url === null || data.encrypted_token === null) return null;
  return { instanceUrl: data.instance_url, token: decryptSecret(data.encrypted_token) };
}

export type CanvasSyncOutcome = { kind: "decrypt_failed" } | { kind: "sync_failed"; message: string; authExpired?: boolean } | { kind: "ok" };

/**
 * The three-way sync-status write P2-22's own `refreshCanvasCourses`
 * established (decrypt-throw → 'expired'; any other failure ->
 * last_sync_error only, token_status untouched; success -> stamp
 * last_synced_at, clear the error) — factored out here so the new Canvas
 * cron sync (per-user, per-sync-kind: courses/announcements/grades) writes
 * the identical outcome shape a human clicking "Sync courses" already
 * does, rather than a second, subtly different implementation of the same
 * three branches.
 */
export async function recordCanvasSyncOutcomeCore(supabase: SupabaseClient, userId: string, outcome: CanvasSyncOutcome): Promise<void> {
  const now = new Date().toISOString();
  if (outcome.kind === "decrypt_failed") {
    await supabase
      .from("canvas_connections")
      .update({ token_status: "expired", last_sync_error: "Your saved Canvas token can't be read anymore. Reconnect.", updated_at: now })
      .eq("user_id", userId);
    return;
  }
  if (outcome.kind === "sync_failed") {
    await supabase
      .from("canvas_connections")
      .update({ last_sync_error: outcome.message, ...(outcome.authExpired ? { token_status: "expired" as const } : {}), updated_at: now })
      .eq("user_id", userId);
    return;
  }
  await supabase.from("canvas_connections").update({ last_synced_at: now, last_sync_error: null, updated_at: now }).eq("user_id", userId);
}
