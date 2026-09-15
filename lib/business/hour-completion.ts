import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/notifications/send-push";
import { KIND_LABEL, type WorkSessionKind } from "@/lib/business/work-session-kind";

/**
 * Phase 2 #P2-04 — "The Hour" (Lock-In's work_sessions timer) currently has
 * no out-of-app signal when a session crosses 60 minutes; a user who
 * backgrounds or closes the tab only finds out by reopening it. This is the
 * one-time push half of that convenience. The in-app half is purely
 * client-derived (components/business/lock-in-session.tsx,
 * components/business/lock-in-overlay.tsx) — no server round trip needed to
 * know "my own elapsed time crossed 60 minutes."
 *
 * Filters on `counts_toward_hours`, never a hardcoded kind list — same rule
 * migration 057's comment states for every reader of this table
 * (lib/evening-close/hours-today.ts follows it too): the generated column is
 * the single source of truth for "does this count as an Hour," so a future
 * kind added to that generated expression is covered here automatically.
 */

const HOUR_COMPLETION_MINUTES = 60;

export interface ProcessHourCompletionsResult {
  candidates: number;
  notified: number;
}

/**
 * Piggybacks on the EXISTING 5-minute pg_cron -> pg_net poll
 * (app/api/cron/scheduled-actions/route.ts, registered 2026-09-09) rather
 * than registering a new cron job — an Hour-completion ping is exactly the
 * same "check active timers, fire at most once" shape the scheduler already
 * runs on a schedule a closed tab can still be reached by.
 *
 * CHECK-THEN-SEND-THEN-RECORD, same ordering as notify-core.ts's
 * sendScheduledNotificationCore, not claim-then-send: if `sendPushToUser`
 * throws (a genuine delivery failure, not "no devices" — that returns
 * normally), the row is left unmarked and retried on the next poll rather
 * than being recorded as notified when nothing was ever sent. The final
 * write is still conditioned on `hour_notified_at is null` so a hypothetical
 * overlapping run can't double-count `notified`.
 */
export async function processHourCompletions(serviceClient: SupabaseClient): Promise<ProcessHourCompletionsResult> {
  const cutoffIso = new Date(Date.now() - HOUR_COMPLETION_MINUTES * 60_000).toISOString();

  const { data, error } = await serviceClient
    .from("work_sessions")
    .select("id, user_id, kind")
    .eq("counts_toward_hours", true)
    .is("ended_at", null)
    .is("hour_notified_at", null)
    .lte("started_at", cutoffIso);
  if (error) throw error;

  const rows = (data ?? []) as { id: string; user_id: string; kind: string }[];
  let notified = 0;

  for (const row of rows) {
    const label = KIND_LABEL[row.kind as WorkSessionKind] ?? "focus";
    try {
      await sendPushToUser(
        serviceClient,
        row.user_id,
        "Hour complete",
        `Your 60-minute ${label.toLowerCase()} session just hit an hour.`,
        "/business"
      );
    } catch {
      continue; // leave hour_notified_at null -- retried on the next 5-minute poll
    }

    const { data: recorded, error: recordError } = await serviceClient
      .from("work_sessions")
      .update({ hour_notified_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("hour_notified_at", null)
      .select("id");
    if (recordError) throw recordError;
    if (recorded && recorded.length > 0) notified++;
  }

  return { candidates: rows.length, notified };
}
