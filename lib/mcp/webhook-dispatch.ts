import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/ai/encryption";
import { safeFetch } from "@/lib/net/safe-outbound-url";
import { WEBHOOK_EVENT, signWebhookPayload, webhookHeaders } from "./webhooks";

/**
 * P4-22 -- the queue-and-drain half of the vertical slice. `enqueue...` is
 * called from lib/agent-api/execute.ts right after a successful audited
 * write, service-role, best-effort (never blocks or fails the triggering
 * call -- same posture as that file's own `touchLastUsed`).
 * `processWebhookDeliveries` is piggybacked onto the EXISTING 5-minute
 * pg_cron -> pg_net poll (app/api/cron/scheduled-actions/route.ts,
 * alongside processScheduledActions/processHourCompletions) -- same
 * reasoning lib/business/hour-completion.ts's own header gives: reusing an
 * already-registered cron avoids a new operator action.
 *
 * ONE RETRY WITH BACKOFF, AUTO-DISABLE (the AC's own words): a delivery
 * that fails once is retried ONE more time after RETRY_BACKOFF_MS,
 * scheduled via `next_attempt_at` -- no busy looping, the next drain tick
 * picks it up. A delivery that fails AGAIN after that retry is marked
 * permanently `failed` and increments its webhook's `failure_count`; once
 * that reaches MAX_FAILURES_BEFORE_DISABLE, the webhook is set `active:
 * false` so a dead receiver stops accumulating failed deliveries forever.
 * A single successful delivery resets `failure_count` back to 0 -- an
 * intermittently-flaky receiver is never one bad day away from permanent
 * disable.
 */

const RETRY_BACKOFF_MS = 5 * 60 * 1000;
const MAX_FAILURES_BEFORE_DISABLE = 3;
const DRAIN_BATCH_LIMIT = 50;

export interface WriteOkEventPayload {
  operation: string;
  summary: string;
}

/**
 * Enqueues one delivery row per ACTIVE webhook this user has subscribed to
 * `write.ok` -- never delivers inline. A user with zero webhooks is the
 * overwhelmingly common case and this returns instantly (one cheap select,
 * no insert) for them.
 */
export async function enqueueWriteOkWebhookDeliveries(supabase: SupabaseClient, userId: string, event: WriteOkEventPayload): Promise<void> {
  const { data: webhooks } = await supabase.from("mcp_webhooks").select("id").eq("user_id", userId).eq("event", WEBHOOK_EVENT).eq("active", true);
  if (!webhooks || webhooks.length === 0) return;

  const payload = { event: WEBHOOK_EVENT, operation: event.operation, summary: event.summary, at: new Date().toISOString() };
  const rows = webhooks.map((w) => ({ webhook_id: w.id as string, user_id: userId, event: WEBHOOK_EVENT, payload }));
  await supabase.from("mcp_webhook_deliveries").insert(rows);
}

export interface ProcessWebhookDeliveriesResult {
  attempted: number;
  delivered: number;
  retried: number;
  failed: number;
  disabled: number;
}

interface PendingDeliveryRow {
  id: string;
  webhook_id: string;
  payload: unknown;
  attempt_count: number;
}

interface WebhookForDeliveryRow {
  url: string;
  encrypted_secret: string;
  failure_count: number;
  active: boolean;
}

export async function processWebhookDeliveries(serviceClient: SupabaseClient, now: Date = new Date()): Promise<ProcessWebhookDeliveriesResult> {
  const result: ProcessWebhookDeliveriesResult = { attempted: 0, delivered: 0, retried: 0, failed: 0, disabled: 0 };

  const { data: pending } = await serviceClient
    .from("mcp_webhook_deliveries")
    .select("id, webhook_id, payload, attempt_count")
    .eq("status", "pending")
    .lte("next_attempt_at", now.toISOString())
    .limit(DRAIN_BATCH_LIMIT);
  if (!pending || pending.length === 0) return result;

  for (const delivery of pending as PendingDeliveryRow[]) {
    result.attempted++;
    const { data: webhook } = await serviceClient
      .from("mcp_webhooks")
      .select("url, encrypted_secret, failure_count, active")
      .eq("id", delivery.webhook_id)
      .maybeSingle();
    const webhookRow = webhook as WebhookForDeliveryRow | null;

    if (!webhookRow || !webhookRow.active) {
      // The owner removed or disabled it between enqueue and drain -- not a
      // delivery failure, just nothing left to deliver to.
      await serviceClient.from("mcp_webhook_deliveries").update({ status: "failed", last_error: "Webhook no longer active." }).eq("id", delivery.id);
      result.failed++;
      continue;
    }

    const body = JSON.stringify(delivery.payload);
    const timestamp = now.getTime().toString();
    const signature = signWebhookPayload(decryptSecret(webhookRow.encrypted_secret), timestamp, body);

    let errorMessage: string | null = null;
    try {
      const res = await safeFetch(webhookRow.url, { method: "POST", headers: webhookHeaders(timestamp, signature), body });
      if (!res.ok) errorMessage = `HTTP ${res.status}`;
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : "Delivery failed.";
    }

    if (!errorMessage) {
      await serviceClient.from("mcp_webhook_deliveries").update({ status: "delivered", delivered_at: now.toISOString() }).eq("id", delivery.id);
      await serviceClient
        .from("mcp_webhooks")
        .update({ failure_count: 0, last_delivery_at: now.toISOString(), last_delivery_status: "ok", last_delivery_error: null })
        .eq("id", delivery.webhook_id);
      result.delivered++;
      continue;
    }

    if (delivery.attempt_count === 0) {
      await serviceClient
        .from("mcp_webhook_deliveries")
        .update({ attempt_count: 1, next_attempt_at: new Date(now.getTime() + RETRY_BACKOFF_MS).toISOString(), last_error: errorMessage })
        .eq("id", delivery.id);
      result.retried++;
      continue;
    }

    const newFailureCount = webhookRow.failure_count + 1;
    const shouldDisable = newFailureCount >= MAX_FAILURES_BEFORE_DISABLE;
    await serviceClient.from("mcp_webhook_deliveries").update({ status: "failed", last_error: errorMessage }).eq("id", delivery.id);
    await serviceClient
      .from("mcp_webhooks")
      .update({ failure_count: newFailureCount, active: !shouldDisable, last_delivery_at: now.toISOString(), last_delivery_status: "failed", last_delivery_error: errorMessage })
      .eq("id", delivery.webhook_id);
    result.failed++;
    if (shouldDisable) result.disabled++;
  }

  return result;
}
