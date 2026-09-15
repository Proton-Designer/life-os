"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { encryptSecret, isKeyStorageConfigured, last4 } from "@/lib/ai/encryption";
import { verifyCanvasToken, fetchCanvasCourses } from "@/lib/canvas/client";
import { resolveCanvasConnectionCore, recordCanvasSyncOutcomeCore } from "@/lib/canvas/connection-core";
import { checkUrlSyntax, resolveSafeOutboundUrl, safeOrigin } from "@/lib/net/safe-outbound-url";

/**
 * Bring-your-own Canvas connection management, mirroring api-key-actions.ts's
 * rule: no function here ever returns a token, in any form, to anything that
 * reaches a browser. `CanvasConnectionStatus` carries `tokenLast4` only.
 */

export interface CanvasConnectionStatus {
  connected: boolean;
  instanceUrl: string | null;
  tokenLast4: string | null;
  canvasUserName: string | null;
  /** 'ok' | 'expired' — only meaningful when `connected`. See migration 213's column comment. */
  tokenStatus: "ok" | "expired" | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

export interface CanvasActionResult {
  ok: boolean;
  message: string;
}

export interface CanvasCourseMapping {
  id: string;
  canvasCourseId: string;
  canvasCourseName: string;
  canvasCourseCode: string | null;
  classId: string | null;
}

export interface LocalClassOption {
  id: string;
  label: string;
}

export async function getCanvasConnectionStatus(): Promise<CanvasConnectionStatus> {
  const { supabase, userId } = await requireUser();
  const { data } = await supabase
    .from("canvas_connections")
    .select("instance_url, token_last4, canvas_user_name, token_status, last_synced_at, last_sync_error")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    return {
      connected: false,
      instanceUrl: null,
      tokenLast4: null,
      canvasUserName: null,
      tokenStatus: null,
      lastSyncedAt: null,
      lastSyncError: null,
    };
  }
  return {
    connected: true,
    instanceUrl: data.instance_url,
    tokenLast4: data.token_last4,
    canvasUserName: data.canvas_user_name,
    tokenStatus: data.token_status as "ok" | "expired",
    lastSyncedAt: data.last_synced_at,
    lastSyncError: data.last_sync_error,
  };
}

/**
 * Verifies against Canvas BEFORE storing — same order as saveApiKey
 * (api-key-actions.ts): a mistyped token or URL must surface here, once, at
 * connect time, not as a silent "sync found nothing" later.
 *
 * SSRF (P2-20 security review): the pasted instance URL is validated here
 * explicitly (syntax + a real DNS resolution, not just an https:// regex)
 * AND, independently, on every subsequent fetch inside lib/canvas/client.ts
 * via `safeFetch` — the two checks don't share a cache, so a host that was
 * safe at connect time still gets re-checked at sync time (DNS rebinding).
 * Only the normalized origin (scheme+host, no path/query/fragment) is ever
 * stored — never the raw pasted string, which could carry attacker-chosen
 * path/query content into every future request built from it.
 */
export async function connectCanvas(instanceUrl: string, rawToken: string): Promise<CanvasActionResult> {
  const rawUrl = instanceUrl.trim();
  const token = rawToken.trim();
  if (!token) return { ok: false, message: "Paste your Canvas access token." };
  if (!isKeyStorageConfigured()) {
    return { ok: false, message: "Key storage isn't configured on this deployment, so a token can't be saved securely yet." };
  }

  const syntax = checkUrlSyntax(rawUrl);
  if (!syntax.ok) return { ok: false, message: syntax.message };
  const resolved = await resolveSafeOutboundUrl(rawUrl);
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const url = safeOrigin(rawUrl);

  const check = await verifyCanvasToken(url, token);
  if (!check.ok) return { ok: false, message: check.message };

  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("canvas_connections").upsert(
    {
      user_id: userId,
      instance_url: url,
      encrypted_token: encryptSecret(token),
      token_last4: last4(token),
      canvas_user_id: check.data.canvasUserId,
      canvas_user_name: check.data.name,
      // A fresh, verified token means whatever was stale is no longer true —
      // reset on every successful (re)connect. `last_synced_at` deliberately
      // stays out of this payload: it's sync history, not connection health,
      // and PostgREST's upsert only touches columns present in the body.
      token_status: "ok",
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, message: "Couldn't save that connection. Try again." };

  revalidatePath("/settings");
  revalidatePath("/school");
  return { ok: true, message: `Connected as ${check.data.name}.` };
}

export async function disconnectCanvas(): Promise<CanvasActionResult> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("canvas_connections").delete().eq("user_id", userId);
  if (error) return { ok: false, message: "Couldn't disconnect. Try again." };
  revalidatePath("/settings");
  revalidatePath("/school");
  return { ok: true, message: "Disconnected. Your course mappings are kept in case you reconnect later." };
}

/**
 * Live-fetches the user's active Canvas courses and upserts them into
 * canvas_course_mappings. `class_id` is deliberately absent from the
 * upsert payload — PostgREST's upsert only sets columns present in the
 * request body, so re-syncing (which happens every time this is called,
 * including from the sync-status panel's "Sync courses" button) can never
 * silently null out a mapping the user already made. Only name/code (Canvas
 * facts) are refreshed; class_id (the user's own decision) is untouched.
 *
 * P2-22: every outcome writes canvas_connections' sync-status columns —
 * `last_sync_error` on any failure (cleared on success), `token_status`
 * flipped to 'expired' ONLY when the client reports `authExpired` (a
 * network blip or SSRF-guard rejection must not send the user down a
 * reconnect flow for a problem that isn't the credential).
 *
 * P2-21: the connection-resolve step and the sync-status write both now go
 * through lib/canvas/connection-core.ts's `resolveCanvasConnectionCore`/
 * `recordCanvasSyncOutcomeCore` (R5 extraction) — the new Canvas cron sync
 * needs the identical decrypt-and-resolve step and the identical three-way
 * status write, looped over many users with a service-role client instead
 * of this file's single cookie-authed `requireUser()` call. Behavior here
 * is unchanged; only where the logic lives moved.
 *
 * 04-verification finding (a9, live): the connection-resolve step's
 * `decryptSecret` (or, defensively, anything else in that function) can
 * throw synchronously rather than return a `CanvasClientResult` — a stored
 * token that predates an `API_KEY_ENCRYPTION_SECRET` rotation is the real
 * case, but ANY unhandled throw here left the Server Action rejecting with
 * no sync-status write at all: the UI showed nothing, the DB stayed
 * unchanged, and the user had no way to know sync was silently broken. Two
 * separate try/catches (not one shared one) because they mean different
 * things: a decrypt failure specifically means the credential itself is
 * unusable (token_status: 'expired', matching the 401/403 case above,
 * since both end in "reconnect"); anything else is informational only
 * (last_sync_error, token_status untouched — an unrelated exception is not
 * evidence the token is bad).
 */
export async function refreshCanvasCourses(): Promise<CanvasActionResult> {
  const { supabase, userId } = await requireUser();

  let conn: Awaited<ReturnType<typeof resolveCanvasConnectionCore>>;
  try {
    conn = await resolveCanvasConnectionCore(supabase, userId);
  } catch {
    const message = "Your saved Canvas token can't be read anymore. Reconnect.";
    await recordCanvasSyncOutcomeCore(supabase, userId, { kind: "decrypt_failed" });
    revalidatePath("/settings");
    return { ok: false, message };
  }
  if (!conn) return { ok: false, message: "Connect Canvas first." };

  let res: Awaited<ReturnType<typeof fetchCanvasCourses>>;
  try {
    res = await fetchCanvasCourses(conn.instanceUrl, conn.token);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed unexpectedly. Try again.";
    await supabase
      .from("canvas_connections")
      .update({ last_sync_error: message, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    revalidatePath("/settings");
    return { ok: false, message };
  }
  if (!res.ok) {
    await supabase
      .from("canvas_connections")
      .update({
        last_sync_error: res.message,
        ...(res.authExpired ? { token_status: "expired" as const } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    revalidatePath("/settings");
    return { ok: false, message: res.message };
  }

  const { error } = await supabase.from("canvas_course_mappings").upsert(
    res.data.map((c) => ({
      user_id: userId,
      canvas_course_id: c.canvasCourseId,
      canvas_course_name: c.name,
      canvas_course_code: c.courseCode,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,canvas_course_id" },
  );
  const now = new Date().toISOString();
  if (error) {
    await supabase
      .from("canvas_connections")
      .update({ last_sync_error: "Fetched courses but couldn't save them.", updated_at: now })
      .eq("user_id", userId);
    revalidatePath("/settings");
    return { ok: false, message: "Fetched courses but couldn't save them. Try again." };
  }

  await supabase
    .from("canvas_connections")
    .update({ last_synced_at: now, last_sync_error: null, updated_at: now })
    .eq("user_id", userId);

  revalidatePath("/settings");
  const message =
    res.data.length === 0
      ? "No active courses found on Canvas."
      : `Synced ${res.data.length} course${res.data.length === 1 ? "" : "s"}.`;
  return { ok: true, message };
}

export async function getCanvasCourseMappings(): Promise<CanvasCourseMapping[]> {
  const { supabase, userId } = await requireUser();
  const { data } = await supabase
    .from("canvas_course_mappings")
    .select("id, canvas_course_id, canvas_course_name, canvas_course_code, class_id")
    .eq("user_id", userId)
    .order("canvas_course_name", { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id,
    canvasCourseId: r.canvas_course_id,
    canvasCourseName: r.canvas_course_name,
    canvasCourseCode: r.canvas_course_code,
    classId: r.class_id,
  }));
}

/** The local side of the mapping dropdown — reuses `classes` directly, no new table. */
export async function getLocalClassOptions(): Promise<LocalClassOption[]> {
  const { supabase, userId } = await requireUser();
  const { data } = await supabase
    .from("classes")
    .select("id, short_name, code")
    .eq("user_id", userId)
    .order("code", { ascending: true });
  return (data ?? []).map((c) => ({ id: c.id, label: c.short_name ?? c.code }));
}

export async function setCourseMapping(mappingId: string, classId: string | null): Promise<CanvasActionResult> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("canvas_course_mappings")
    .update({ class_id: classId, updated_at: new Date().toISOString() })
    .eq("id", mappingId)
    .eq("user_id", userId);
  if (error) return { ok: false, message: "Couldn't update that mapping. Try again." };
  revalidatePath("/settings");
  revalidatePath("/school");
  return { ok: true, message: "Mapping updated." };
}
