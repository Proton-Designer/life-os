import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/ai/encryption";
import { fetchCanvasIcsFeed } from "@/lib/canvas/client";
import { reconcileCanvasIcsCore } from "@/lib/canvas/ics-reconcile-core";

/**
 * Automatic refresh of Canvas calendar (ICS) feeds. Some schools block Canvas access tokens, so the feed is the person's ONLY path; until
 * now it was reconciled only when they clicked the Settings button, and the canvas-sync cron handles token users only. The cron now also
 * calls this: every connected feed is checked at most every 6 hours (`last_ics_reconcile_at`), a per-run cap bounds one invocation, and a
 * failure (404 / reset feed, unreadable URL) is written where Settings shows it, never thrown.
 *
 * The ICS error shares `canvas_connections.last_sync_error` with the token sync, so it carries a prefix: a later ICS success clears only
 * its own error, never a token-sync error.
 */
export const ICS_AUTO_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const MAX_ICS_FEEDS_PER_RUN = 10;
export const ICS_ERROR_PREFIX = "Calendar feed: ";
const FETCH_HINT = " Your feed link may have been reset in Canvas: paste a new one from Canvas > Calendar > Calendar Feed.";

export interface IcsAutoDeps {
  fetchFeed: (url: string) => Promise<{ ok: true; data: string } | { ok: false; message: string }>;
  reconcile: typeof reconcileCanvasIcsCore;
  decrypt: (stored: string) => string;
}
const DEFAULT_DEPS: IcsAutoDeps = { fetchFeed: fetchCanvasIcsFeed, reconcile: reconcileCanvasIcsCore, decrypt: decryptSecret };

export type IcsOutcome = { ok: true } | { ok: false; message: string };

/** Stamps "last checked" (also on failure, so a broken feed backs off for the interval) and writes or clears the calendar-feed error. */
export async function recordIcsOutcome(supabase: SupabaseClient, userId: string, outcome: IcsOutcome, now: Date): Promise<void> {
  const stamp = { last_ics_reconcile_at: now.toISOString(), updated_at: now.toISOString() };
  if (!outcome.ok) {
    const withHint = /HTTP (401|403|404|410)/.test(outcome.message) ? `${outcome.message}${FETCH_HINT}` : outcome.message;
    await supabase.from("canvas_connections").update({ ...stamp, last_sync_error: `${ICS_ERROR_PREFIX}${withHint}` }).eq("user_id", userId);
    return;
  }
  await supabase.from("canvas_connections").update(stamp).eq("user_id", userId);
  // clear only OUR error
  await supabase.from("canvas_connections").update({ last_sync_error: null }).eq("user_id", userId).like("last_sync_error", `${ICS_ERROR_PREFIX}%`);
}

export interface IcsAutoResult {
  checked: number;
  reconciled: number;
  failed: number;
  newlyStaged: number;
}

export async function reconcileDueIcsFeeds(supabase: SupabaseClient, now: Date, deps: IcsAutoDeps = DEFAULT_DEPS): Promise<IcsAutoResult> {
  const result: IcsAutoResult = { checked: 0, reconciled: 0, failed: 0, newlyStaged: 0 };
  const cutoff = new Date(now.getTime() - ICS_AUTO_RECONCILE_INTERVAL_MS).toISOString();
  const { data, error } = await supabase
    .from("canvas_connections")
    .select("user_id, encrypted_ics_feed_url")
    .not("encrypted_ics_feed_url", "is", null)
    .or(`last_ics_reconcile_at.is.null,last_ics_reconcile_at.lt.${cutoff}`)
    .order("last_ics_reconcile_at", { ascending: true, nullsFirst: true })
    .limit(MAX_ICS_FEEDS_PER_RUN);
  if (error) throw error;

  for (const conn of (data ?? []) as { user_id: string; encrypted_ics_feed_url: string }[]) {
    result.checked += 1;
    const fail = async (message: string) => {
      result.failed += 1;
      await recordIcsOutcome(supabase, conn.user_id, { ok: false, message }, now).catch(() => {});
    };
    try {
      let url: string;
      try {
        url = deps.decrypt(conn.encrypted_ics_feed_url);
      } catch {
        await fail("Your saved calendar feed link can't be read anymore. Paste it again.");
        continue;
      }
      const fetched = await deps.fetchFeed(url);
      if (!fetched.ok) {
        await fail(fetched.message);
        continue;
      }
      const { data: profile } = await supabase.from("profiles").select("timezone").eq("user_id", conn.user_id).maybeSingle();
      const timezone = (profile as { timezone: string | null } | null)?.timezone ?? "UTC";
      const summary = await deps.reconcile(supabase, conn.user_id, timezone, fetched.data);
      result.reconciled += 1;
      result.newlyStaged += summary.newlyStaged;
      await recordIcsOutcome(supabase, conn.user_id, { ok: true }, now);
    } catch (e) {
      console.error("[canvas-sync] ICS reconcile failed for a user", e instanceof Error ? e.message : e);
      await fail("Reconciling your calendar feed failed unexpectedly. It will be tried again.");
    }
  }
  return result;
}
