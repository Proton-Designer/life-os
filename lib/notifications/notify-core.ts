import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString } from "@/lib/date-utils";
import { sendPushToUser, hasAnyPushSubscription } from "./send-push";

/**
 * L7 notify delivery — the runner's `fn` for a `tool_name: 'notify'`
 * scheduled action, called through the SAME `runMcpTool` a write action
 * goes through (lib/mcp/scheduler-runner.ts), for the identical audit-
 * logging reason. This file owns the idempotency mechanism the lead asked
 * for: check-then-send-then-record, NOT claim-then-send.
 *
 * WHY CHECK-THEN-SEND, NOT CLAIM-THEN-SEND (insert the dispatch-log row
 * BEFORE attempting delivery): claiming first would mean a genuinely
 * FAILED send (a transient webpush error, not "no subscription at all")
 * gets recorded as "handled" anyway, so nothing — not a crash-retry, not
 * the runner's own bounded retry for a one-off — could ever try again
 * TODAY. That directly fights the lead's requirement #3 ("a push failure
 * ... shouldn't pause a recurring reminder forever" — the same reasoning
 * applies to same-day retry of a one-off's transient failure). Instead:
 * the dispatch-log row is written ONLY after `delivered > 0` (a real send
 * succeeded to at least one device). A failed attempt writes nothing, so
 * the next attempt (today, if the runner retries a one-off; tomorrow, for
 * a recurring reminder's next natural occurrence) genuinely retries.
 *
 * THE RESIDUAL GAP, STATED HONESTLY: a crash between a successful
 * `sendPushToUser` and this file's own `recordSent` insert would leave the
 * dispatch-log row unwritten despite real delivery, so a later retry could
 * genuinely double-notify. This is the same accepted "writes must tolerate
 * running twice" gap `claimDueActions` already documents for write
 * actions — for a notification specifically, that means "the user might
 * see the same reminder twice," a real but non-catastrophic failure mode,
 * not a silent one (both sends are audited).
 */

export interface SendScheduledNotificationResult {
  delivered: number;
  total: number;
  /** True when this occurrence was already successfully delivered earlier (a retry of an already-completed send) — the push was NOT re-sent. */
  alreadySent: boolean;
}

async function alreadySentToday(supabase: SupabaseClient, scheduledActionId: string, sentDate: string): Promise<boolean> {
  const { data, error } = await supabase.from("mcp_notification_dispatch_log").select("id").eq("scheduled_action_id", scheduledActionId).eq("sent_date", sentDate).maybeSingle();
  if (error) throw error;
  return !!data;
}

async function recordSent(supabase: SupabaseClient, userId: string, scheduledActionId: string, sentDate: string): Promise<void> {
  const { error } = await supabase.from("mcp_notification_dispatch_log").insert({ user_id: userId, scheduled_action_id: scheduledActionId, sent_date: sentDate });
  // 23505 here means a genuinely concurrent send already recorded this
  // occurrence (the residual gap this file's own header names) -- the
  // push already happened either way, nothing more to record.
  if (error && (error as { code?: string }).code !== "23505") throw error;
}

export async function sendScheduledNotificationCore(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date,
  scheduledActionId: string,
  title: unknown,
  body: unknown,
): Promise<SendScheduledNotificationResult> {
  if (typeof title !== "string" || title.length === 0) {
    throw new Error("patch.title is required and must be a non-empty string.");
  }
  if (typeof body !== "string" || body.length === 0) {
    throw new Error("patch.body is required and must be a non-empty string.");
  }

  const sentDate = localDateString(now, timezone);
  if (await alreadySentToday(supabase, scheduledActionId, sentDate)) {
    return { delivered: 0, total: 0, alreadySent: true };
  }

  const result = await sendPushToUser(supabase, userId, title, body);
  if (result.delivered > 0) {
    await recordSent(supabase, userId, scheduledActionId, sentDate);
  }
  return { delivered: result.delivered, total: result.total, alreadySent: false };
}

export { hasAnyPushSubscription };
