import "server-only";
import { randomBytes, createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptSecret, decryptSecret, isKeyStorageConfigured, last4 } from "@/lib/ai/encryption";
import { checkUrlSyntax, resolveSafeOutboundUrl, safeFetch } from "@/lib/net/safe-outbound-url";

/**
 * P4-22 -- outbound webhooks, vertical slice (migration 209). ONE event
 * type today: `WEBHOOK_EVENT` ("write.ok"), fired after a successful
 * audited write (lib/agent-api/execute.ts enqueues via
 * lib/mcp/webhook-dispatch.ts's `enqueueWriteOkWebhookDeliveries`).
 *
 * encrypted_secret is REVERSIBLE (lib/ai/encryption.ts, AES-256-GCM), not
 * hashed like a PAT -- an HMAC signature needs the raw secret bytes at
 * delivery time, every time, not a one-way compare. Same posture as
 * canvas_connections.encrypted_token. The raw secret is returned from
 * `createWebhookCore` exactly once, at creation -- no function in this
 * module ever reads it back out to a caller after that (test-fire
 * decrypts it internally to sign a request, never returns it).
 */

export const WEBHOOK_EVENT = "write.ok" as const;

export interface WebhookStatus {
  id: string;
  url: string;
  secretLast4: string;
  event: string;
  active: boolean;
  failureCount: number;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: "ok" | "failed" | null;
  lastDeliveryError: string | null;
  createdAt: string;
}

interface WebhookRow {
  id: string;
  url: string;
  secret_last4: string;
  event: string;
  active: boolean;
  failure_count: number;
  last_delivery_at: string | null;
  last_delivery_status: string | null;
  last_delivery_error: string | null;
  created_at: string;
}

const WEBHOOK_STATUS_COLUMNS = "id, url, secret_last4, event, active, failure_count, last_delivery_at, last_delivery_status, last_delivery_error, created_at";

function toStatus(row: WebhookRow): WebhookStatus {
  return {
    id: row.id,
    url: row.url,
    secretLast4: row.secret_last4,
    event: row.event,
    active: row.active,
    failureCount: row.failure_count,
    lastDeliveryAt: row.last_delivery_at,
    lastDeliveryStatus: row.last_delivery_status as "ok" | "failed" | null,
    lastDeliveryError: row.last_delivery_error,
    createdAt: row.created_at,
  };
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** `HMAC-SHA256(secret, "<timestamp>.<rawBody>")`, hex-encoded. Binding the timestamp into the signed material (not just sending it alongside) is what makes a captured request unreplayable after the receiver's own tolerance window, not merely tamper-evident. */
export function signWebhookPayload(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function webhookHeaders(timestamp: string, signature: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "X-LifeOS-Webhook-Timestamp": timestamp,
    "X-LifeOS-Webhook-Signature": `sha256=${signature}`,
  };
}

export interface CreateWebhookResult {
  ok: boolean;
  message: string;
  /** The RAW secret -- present exactly once, on a successful creation. Same posture as createAccessToken's own `token` field. */
  secret?: string;
  status?: WebhookStatus;
}

export async function createWebhookCore(supabase: SupabaseClient, userId: string, rawUrl: string): Promise<CreateWebhookResult> {
  const url = rawUrl.trim();
  if (!url) return { ok: false, message: "Paste the URL that should receive webhook deliveries." };
  if (!isKeyStorageConfigured()) {
    return { ok: false, message: "Key storage isn't configured on this deployment, so a signing secret can't be saved securely yet." };
  }

  const syntax = checkUrlSyntax(url);
  if (!syntax.ok) return { ok: false, message: syntax.message };
  const resolved = await resolveSafeOutboundUrl(url);
  if (!resolved.ok) return { ok: false, message: resolved.message };

  const secret = generateWebhookSecret();
  const { data, error } = await supabase
    .from("mcp_webhooks")
    .insert({ user_id: userId, url, encrypted_secret: encryptSecret(secret), secret_last4: last4(secret), event: WEBHOOK_EVENT })
    .select(WEBHOOK_STATUS_COLUMNS)
    .single();
  if (error || !data) return { ok: false, message: "Couldn't create the webhook. Try again." };

  return { ok: true, message: "Webhook created.", secret, status: toStatus(data as WebhookRow) };
}

export async function listWebhooksCore(supabase: SupabaseClient, userId: string): Promise<WebhookStatus[]> {
  const { data, error } = await supabase.from("mcp_webhooks").select(WEBHOOK_STATUS_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as WebhookRow[]).map(toStatus);
}

export interface WebhookActionResult {
  ok: boolean;
  message: string;
}

export async function deleteWebhookCore(supabase: SupabaseClient, userId: string, id: string): Promise<WebhookActionResult> {
  const { error } = await supabase.from("mcp_webhooks").delete().eq("id", id).eq("user_id", userId);
  if (error) return { ok: false, message: "Couldn't remove the webhook. Try again." };
  return { ok: true, message: "Webhook removed." };
}

/**
 * Delivers ONE real, signed test payload immediately (not queued) so the
 * owner can confirm their receiver is wired up right away, rather than
 * waiting for a real write to happen. Reuses the exact same signing
 * (`signWebhookPayload`) and SSRF-guarded transport (`safeFetch`) the real
 * dispatch job uses -- a test-fire that passed but a real delivery that
 * failed would mean the two paths had silently diverged.
 */
export async function testFireWebhookCore(supabase: SupabaseClient, userId: string, id: string): Promise<WebhookActionResult> {
  const { data } = await supabase.from("mcp_webhooks").select("url, encrypted_secret").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data) return { ok: false, message: "Webhook not found." };

  const payload = { event: WEBHOOK_EVENT, test: true, at: new Date().toISOString() };
  const body = JSON.stringify(payload);
  const timestamp = Date.now().toString();
  const secret = decryptSecret(data.encrypted_secret);
  const signature = signWebhookPayload(secret, timestamp, body);

  try {
    const res = await safeFetch(data.url, { method: "POST", headers: webhookHeaders(timestamp, signature), body });
    if (!res.ok) return { ok: false, message: `Test delivery failed: HTTP ${res.status}.` };
    return { ok: true, message: "Test delivery sent -- check your receiver." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Test delivery failed. Try again." };
  }
}
