"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { encryptSecret, decryptSecret, isKeyStorageConfigured, last4 } from "@/lib/ai/encryption";
import { verifyRescueTimeKey, fetchDailySummaries } from "@/lib/rescuetime/client";

/**
 * BYOK RescueTime connection management, same shape as canvas-actions.ts:
 * no function here ever returns the key, in any form, to anything that
 * reaches a browser -- `RescueTimeConnectionStatus` carries `keyLast4` only.
 */

export interface RescueTimeConnectionStatus {
  connected: boolean;
  keyLast4: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

export interface RescueTimeActionResult {
  ok: boolean;
  message: string;
}

const SYNC_DAYS_KEPT = 30; // how many of the feed's most-recent rows get upserted per sync -- bounds row growth, still plenty for a productivity trend.

export async function getRescueTimeConnectionStatus(): Promise<RescueTimeConnectionStatus> {
  const { supabase, userId } = await requireUser();
  const { data } = await supabase
    .from("rescuetime_connections")
    .select("key_last4, last_synced_at, last_sync_error")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return { connected: false, keyLast4: null, lastSyncedAt: null, lastSyncError: null };
  return { connected: true, keyLast4: data.key_last4, lastSyncedAt: data.last_synced_at, lastSyncError: data.last_sync_error };
}

/**
 * Verifies against RescueTime BEFORE storing -- same order as
 * connectCanvas/saveApiKey: a mistyped key must surface here, once, at
 * connect time, not as a silent "sync found nothing" later.
 */
export async function connectRescueTime(rawKey: string): Promise<RescueTimeActionResult> {
  const key = rawKey.trim();
  if (!key) return { ok: false, message: "Paste your RescueTime API key." };
  if (!isKeyStorageConfigured()) {
    return { ok: false, message: "Key storage isn't configured on this deployment, so a key can't be saved securely yet." };
  }

  const check = await verifyRescueTimeKey(key);
  if (!check.ok) return { ok: false, message: check.message };

  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("rescuetime_connections").upsert(
    {
      user_id: userId,
      encrypted_key: encryptSecret(key),
      key_last4: last4(key),
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, message: "Couldn't save that connection. Try again." };

  revalidatePath("/settings");
  revalidatePath("/insights");
  return { ok: true, message: "Connected." };
}

export async function disconnectRescueTime(): Promise<RescueTimeActionResult> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("rescuetime_connections").delete().eq("user_id", userId);
  if (error) return { ok: false, message: "Couldn't disconnect. Try again." };
  revalidatePath("/settings");
  revalidatePath("/insights");
  return { ok: true, message: "Disconnected. Cached productivity data is kept in case you reconnect later." };
}

/**
 * Server-only helper: resolves the stored connection's plaintext key. Never
 * exported -- same discipline as canvas-actions.ts's resolveStoredConnection.
 */
async function resolveStoredKey(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
): Promise<string | null> {
  const { data } = await supabase.from("rescuetime_connections").select("encrypted_key").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  return decryptSecret(data.encrypted_key);
}

/**
 * Live-fetches the daily summary feed and upserts the most recent
 * SYNC_DAYS_KEPT rows. Same "never throw out of this action" discipline
 * P2-22's 04-verification fix established for Canvas -- a decrypt failure
 * or any other unexpected exception still records last_sync_error and
 * returns {ok:false} rather than rejecting the Server Action.
 */
export async function syncRescueTimeSummaries(): Promise<RescueTimeActionResult> {
  const { supabase, userId } = await requireUser();

  let key: string | null;
  try {
    key = await resolveStoredKey(supabase, userId);
  } catch {
    const message = "Your saved RescueTime key can't be read anymore. Reconnect.";
    await supabase.from("rescuetime_connections").update({ last_sync_error: message, updated_at: new Date().toISOString() }).eq("user_id", userId);
    revalidatePath("/insights");
    return { ok: false, message };
  }
  if (!key) return { ok: false, message: "Connect RescueTime first." };

  let res: Awaited<ReturnType<typeof fetchDailySummaries>>;
  try {
    res = await fetchDailySummaries(key);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed unexpectedly. Try again.";
    await supabase.from("rescuetime_connections").update({ last_sync_error: message, updated_at: new Date().toISOString() }).eq("user_id", userId);
    revalidatePath("/insights");
    return { ok: false, message };
  }
  if (!res.ok) {
    await supabase.from("rescuetime_connections").update({ last_sync_error: res.message, updated_at: new Date().toISOString() }).eq("user_id", userId);
    revalidatePath("/insights");
    return { ok: false, message: res.message };
  }

  const rows = res.data.slice(0, SYNC_DAYS_KEPT);
  if (rows.length > 0) {
    const { error: upsertError } = await supabase.from("rescuetime_daily_summaries").upsert(
      rows.map((r) => ({
        user_id: userId,
        summary_date: r.date,
        productivity_pulse: r.productivityPulse,
        very_productive_percentage: r.veryProductivePct,
        productive_percentage: r.productivePct,
        neutral_percentage: r.neutralPct,
        distracting_percentage: r.distractingPct,
        very_distracting_percentage: r.veryDistractingPct,
        total_hours: r.totalHours,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "user_id,summary_date" },
    );
    if (upsertError) {
      const message = "Fetched data but couldn't save it. Try again.";
      await supabase.from("rescuetime_connections").update({ last_sync_error: message, updated_at: new Date().toISOString() }).eq("user_id", userId);
      revalidatePath("/insights");
      return { ok: false, message };
    }
  }

  const now = new Date().toISOString();
  await supabase.from("rescuetime_connections").update({ last_synced_at: now, last_sync_error: null, updated_at: now }).eq("user_id", userId);
  revalidatePath("/settings");
  revalidatePath("/insights");
  return { ok: true, message: `Synced ${rows.length} day${rows.length === 1 ? "" : "s"}.` };
}
