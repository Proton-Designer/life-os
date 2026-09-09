import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A GENERIC "send this user a web push" function — built for L7's notify
 * action (lib/mcp/scheduler-runner.ts), NOT a refactor of
 * supabase/functions/dispatch-notifications/index.ts. That function is
 * live, prayer-specific (its title/body are hardcoded per prayer name, its
 * push-send call is inlined in its own loop, not exported/reusable), and
 * the lead's explicit instruction was to leave it alone and accept
 * duplication rather than touch it "on the way past." This file
 * deliberately re-fetches the same Vault secrets and re-implements the
 * same webpush call shape, independently.
 *
 * VERIFIED, NOT ASSUMED, THAT THIS WORKS FROM A VERCEL ROUTE: `get_vault_secrets`
 * (migration baseline) is a plain `SECURITY DEFINER` SQL function granted
 * to `service_role` — `GRANT ALL ... TO "service_role"`, nothing about it
 * scoped to Deno/Edge Functions. It's callable via ordinary PostgREST RPC
 * from any client authenticated as service_role, which is exactly what
 * `createServiceRoleClient()` (already used by app/api/cron/
 * scheduled-actions/route.ts) builds. Read the migration's own SQL to
 * confirm this before writing a line of this file, per the lead's explicit
 * instruction not to assume it.
 */

interface VapidSecrets {
  publicKey: string;
  privateKey: string;
  subject: string;
}

async function fetchVapidSecrets(supabase: SupabaseClient): Promise<VapidSecrets> {
  const { data, error } = await supabase.rpc("get_vault_secrets", {
    secret_names: ["vapid_public_key", "vapid_private_key", "vapid_subject"],
  });
  if (error || !data) {
    throw new Error(`Failed to read VAPID secrets from Vault: ${error?.message ?? "no data"}`);
  }
  const secrets = new Map((data as { name: string; decrypted_secret: string }[]).map((r) => [r.name, r.decrypted_secret]));
  const publicKey = secrets.get("vapid_public_key");
  const privateKey = secrets.get("vapid_private_key");
  const subject = secrets.get("vapid_subject");
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID secrets missing from Vault.");
  }
  return { publicKey, privateKey, subject };
}

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

export interface SendPushResult {
  /** Whether this user has ANY registered device at all — checked separately from delivery success so a caller (createScheduledActionCore) can refuse at SCHEDULE time when this would be false, per the lead's requirement #4. */
  hadSubscriptions: boolean;
  /** How many of this user's subscriptions the push was actually delivered to — 0 with hadSubscriptions:true means every registered device rejected it (expired/unsubscribed), a DELIVERY failure distinct from "never had a device". */
  delivered: number;
  total: number;
}

/**
 * Sends `title`/`body` to every device this user has registered
 * (push_subscriptions). A dead/expired subscription (410/404, or any
 * other send error) does not stop delivery to the user's OTHER devices —
 * same per-subscription try/catch posture dispatch-notifications' own
 * loop already takes, not proactively deleting the stale row here either
 * (same "out of scope for this task" call that function's own header
 * makes).
 */
export async function sendPushToUser(supabase: SupabaseClient, userId: string, title: string, body: string, url = "/"): Promise<SendPushResult> {
  const { data, error } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth_key").eq("user_id", userId);
  if (error) throw error;
  const subs = (data ?? []) as PushSubscriptionRow[];
  if (subs.length === 0) {
    return { hadSubscriptions: false, delivered: 0, total: 0 };
  }

  const { publicKey, privateKey, subject } = await fetchVapidSecrets(supabase);
  webpush.setVapidDetails(subject, publicKey, privateKey);

  let delivered = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, JSON.stringify({ title, body, url }));
      delivered++;
    } catch {
      // A single dead subscription must not fail delivery to this user's
      // other devices, or crash the caller — see this function's own header.
    }
  }
  return { hadSubscriptions: true, delivered, total: subs.length };
}

/** Whether this user has at least one registered device — the schedule-time check (lead's requirement #4: refuse creating a reminder that cannot possibly be delivered, don't wait until it silently fails at fire time). */
export async function hasAnyPushSubscription(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("push_subscriptions").select("endpoint").eq("user_id", userId).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}
