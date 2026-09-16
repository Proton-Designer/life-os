"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { encryptSecret, decryptSecret, isKeyStorageConfigured, last4 } from "@/lib/ai/encryption";
import { verifyCanvasToken, fetchCanvasCourses, fetchConcludedCanvasCourses, fetchCanvasIcsFeed } from "@/lib/canvas/client";
import { resolveCanvasConnectionCore, recordCanvasSyncOutcomeCore } from "@/lib/canvas/connection-core";
import { reconcileCanvasIcsCore, type IcsReconcileResult } from "@/lib/canvas/ics-reconcile-core";
import { autoImportCanvasCoursesAsClassesCore, type AutoImportCoursesResult } from "@/lib/canvas/course-auto-import-core";
import { checkUrlSyntax, resolveSafeOutboundUrl, safeOrigin } from "@/lib/net/safe-outbound-url";
import { getProfile } from "@/lib/supabase/auth";
import { icsFeedDisplaySource } from "@/lib/canvas/ics-feed-display";

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
  /** P3-13 -- ICS calendar-feed reconciliation, opt-in and separate from the API connection above. */
  icsFeedConnected: boolean;
  icsFeedLast4: string | null;
  lastIcsReconcileAt: string | null;
}

export interface CanvasActionResult {
  ok: boolean;
  message: string;
  /**
   * CANVAS-LITE-04: how many concluded/inactive courses were found but
   * skipped (only set by `refreshCanvasCourses`, undefined everywhere
   * else) -- lets Settings offer "N concluded courses -- import them?"
   * rather than silently skipping them, without persisting a count
   * anywhere (a fresh number every sync).
   */
  concludedCount?: number;
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
    .select("instance_url, token_last4, canvas_user_name, token_status, last_synced_at, last_sync_error, ics_feed_url_last4, last_ics_reconcile_at")
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
      icsFeedConnected: false,
      icsFeedLast4: null,
      lastIcsReconcileAt: null,
    };
  }
  return {
    // CANVAS-GAP-06: a canvas_connections ROW existing is no longer the
    // same thing as a TOKEN connection existing -- migration 208 lets an
    // ICS-only row exist with instance_url null. `connected` must reflect
    // the token specifically (canvas-settings.tsx's own `path === "token"
    // && status.connected` branch, and defaultCanvasPath's `icsFeedConnected
    // && !connected`, both rely on this to never show token-only
    // affordances to a token-less account).
    connected: data.instance_url !== null,
    instanceUrl: data.instance_url,
    tokenLast4: data.token_last4,
    canvasUserName: data.canvas_user_name,
    tokenStatus: data.token_status as "ok" | "expired",
    lastSyncedAt: data.last_synced_at,
    lastSyncError: data.last_sync_error,
    icsFeedConnected: data.ics_feed_url_last4 !== null,
    icsFeedLast4: data.ics_feed_url_last4,
    lastIcsReconcileAt: data.last_ics_reconcile_at,
  };
}

/**
 * CANVAS-LITE-03: "the user sees what happened... not a silent mutation of
 * their data." Empty string (never a trailing " ()") when there is
 * nothing to report -- e.g. every course was already linked, or there
 * were no active courses at all.
 */
function formatImportSummary(result: AutoImportCoursesResult): string {
  const parts: string[] = [];
  if (result.created > 0) parts.push(`${result.created} class${result.created === 1 ? "" : "es"} added`);
  if (result.adopted > 0) parts.push(`${result.adopted} matched to an existing class`);
  if (result.skippedDismissed > 0) parts.push(`${result.skippedDismissed} previously removed, left alone`);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
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

  // CANVAS-LITE-03: "connecting Canvas must populate School by itself" --
  // a single step, not connect-then-remember-to-click-Sync. A failure
  // here is NOT a connection failure (the token itself is good and
  // already saved) -- the user can always import via "Sync courses"
  // afterward, so this degrades to an honest note, never a false "ok: false".
  let importNote = " Couldn't import your courses yet -- try \"Sync courses\" below.";
  try {
    const coursesRes = await fetchCanvasCourses(url, token);
    if (coursesRes.ok) {
      const importResult = await autoImportCanvasCoursesAsClassesCore(supabase, userId, coursesRes.data);
      importNote = formatImportSummary(importResult);
    }
  } catch {
    // Same fallback message as coursesRes.ok === false above -- an
    // unexpected throw here is still just "the import step didn't work
    // this time," not evidence the connection itself is bad.
  }

  revalidatePath("/settings");
  revalidatePath("/school");
  return { ok: true, message: `Connected as ${check.data.name}.${importNote}` };
}

/**
 * CANVAS-GAP-07: disconnecting the TOKEN must never destroy an independent
 * ICS feed connection (CANVAS-GAP-06 made a token-less, ICS-only row a
 * real state) -- a full-row DELETE would silently lose the feed URL, the
 * last reconcile time, and be indistinguishable from "never connected" on
 * the next render. If an ICS feed exists, only the token-identity and
 * token-sync-status columns are cleared (left as an honest all-absent
 * token row, satisfying migration 208's own all-or-nothing CHECK);
 * course mappings and the ICS feed's own columns are never touched. Only
 * when there is NOTHING left to keep (no ICS feed either) does this fall
 * back to the old delete-the-row behavior.
 */
export async function disconnectCanvas(): Promise<CanvasActionResult> {
  const { supabase, userId } = await requireUser();
  const { data: existing } = await supabase.from("canvas_connections").select("encrypted_ics_feed_url").eq("user_id", userId).maybeSingle();

  if (existing?.encrypted_ics_feed_url) {
    const { error } = await supabase
      .from("canvas_connections")
      .update({
        instance_url: null,
        encrypted_token: null,
        token_last4: null,
        canvas_user_id: null,
        canvas_user_name: null,
        token_status: null,
        last_synced_at: null,
        last_sync_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (error) return { ok: false, message: "Couldn't disconnect. Try again." };
    revalidatePath("/settings");
    revalidatePath("/school");
    return { ok: true, message: "Token disconnected. Your calendar feed stays connected." };
  }

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

  // CANVAS-LITE-03: this upsert USED TO just refresh name/code with
  // class_id deliberately absent, leaving the user to hand-map every
  // course. autoImportCanvasCoursesAsClassesCore does that same upsert
  // PLUS the adopt-or-create resolution -- one call, not two, so this
  // path and connectCanvas's own first-import step can never drift.
  const now = new Date().toISOString();
  let importResult: AutoImportCoursesResult;
  try {
    importResult = await autoImportCanvasCoursesAsClassesCore(supabase, userId, res.data);
  } catch {
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
  revalidatePath("/school");

  // CANVAS-LITE-04: "state the count and offer to import them, rather
  // than skipping silently." Best-effort and non-blocking -- a failure
  // fetching the concluded list must never fail (or even taint the
  // message of) a sync that itself succeeded; it's extra information,
  // not part of the sync's own contract.
  let concludedCount = 0;
  try {
    const concludedRes = await fetchConcludedCanvasCourses(conn.instanceUrl, conn.token);
    if (concludedRes.ok) concludedCount = concludedRes.data.length;
  } catch {
    // Silently 0 -- the active-course sync above already succeeded and reported.
  }

  const message =
    (res.data.length === 0 ? "No active courses found on Canvas." : `Synced ${res.data.length} course${res.data.length === 1 ? "" : "s"}.${formatImportSummary(importResult)}`) +
    (concludedCount > 0 ? ` ${concludedCount} concluded course${concludedCount === 1 ? "" : "s"} skipped.` : "");
  return { ok: true, message, concludedCount };
}

/**
 * CANVAS-LITE-04: the explicit "import them" side of the concluded-courses
 * offer above -- a separate action, not automatic, since importing a
 * concluded course's classes is a deliberate choice (they're not "what
 * I'm taking right now"). Reuses the exact same shared auto-import core,
 * so a concluded course adopts/never-duplicates a hand-made class exactly
 * like an active one does.
 */
export async function importConcludedCanvasCourses(): Promise<CanvasActionResult> {
  const { supabase, userId } = await requireUser();

  let conn: Awaited<ReturnType<typeof resolveCanvasConnectionCore>>;
  try {
    conn = await resolveCanvasConnectionCore(supabase, userId);
  } catch {
    return { ok: false, message: "Your saved Canvas token can't be read anymore. Reconnect." };
  }
  if (!conn) return { ok: false, message: "Connect Canvas first." };

  let res: Awaited<ReturnType<typeof fetchConcludedCanvasCourses>>;
  try {
    res = await fetchConcludedCanvasCourses(conn.instanceUrl, conn.token);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't fetch concluded courses. Try again." };
  }
  if (!res.ok) return { ok: false, message: res.message };
  if (res.data.length === 0) return { ok: true, message: "No concluded courses found." };

  let importResult: AutoImportCoursesResult;
  try {
    importResult = await autoImportCanvasCoursesAsClassesCore(supabase, userId, res.data);
  } catch {
    return { ok: false, message: "Fetched concluded courses but couldn't save them. Try again." };
  }

  revalidatePath("/settings");
  revalidatePath("/school");
  return { ok: true, message: `Imported ${res.data.length} concluded course${res.data.length === 1 ? "" : "s"}.${formatImportSummary(importResult)}` };
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

/**
 * CANVAS-LITE-03: an explicit unlink (`classId === null`) stamps
 * `dismissed_at` so a future auto-import pass never re-links or
 * re-creates a class for this Canvas course on its own -- "removal
 * sticks." Choosing a REAL class (including re-choosing one after an
 * unlink) is a deliberate act by the user, so it clears `dismissed_at` --
 * the user is actively mapping this course again, not something
 * auto-import should keep hands off of.
 */
export async function setCourseMapping(mappingId: string, classId: string | null): Promise<CanvasActionResult> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("canvas_course_mappings")
    .update({ class_id: classId, dismissed_at: classId === null ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", mappingId)
    .eq("user_id", userId);
  if (error) return { ok: false, message: "Couldn't update that mapping. Try again." };
  revalidatePath("/settings");
  revalidatePath("/school");
  return { ok: true, message: classId === null ? "Unlinked. Won't be re-imported automatically." : "Mapping updated." };
}

/**
 * P3-13 -- saves the user's Canvas ICS calendar-feed URL. A SEPARATE
 * credential from the API token above: the feed URL embeds its own
 * secret in the query string, so the FULL url (not just its origin, per
 * the Lead's ruling that this is a credential) is encrypted at rest via
 * the same helpers `encrypted_token` uses. `token_last4` on the origin-only
 * `instance_url` truncates for display purposes there; here the whole
 * value is the secret, so `last4` is taken from the whole pasted string.
 *
 * SSRF: validated the same way `connectCanvas` validates `instanceUrl`
 * (syntax + a real DNS resolution) -- re-validated again on every actual
 * fetch by `fetchCanvasIcsFeed`'s own `safeFetch` call, same two-layer
 * posture (connect-time + fetch-time) as the API connection.
 */
export async function saveCanvasIcsFeedUrl(rawUrl: string): Promise<CanvasActionResult> {
  const url = rawUrl.trim();
  if (!url) return { ok: false, message: "Paste your Canvas calendar feed URL." };
  if (!isKeyStorageConfigured()) {
    return { ok: false, message: "Key storage isn't configured on this deployment, so a feed URL can't be saved securely yet." };
  }

  const syntax = checkUrlSyntax(url);
  if (!syntax.ok) return { ok: false, message: syntax.message };
  const resolved = await resolveSafeOutboundUrl(url);
  if (!resolved.ok) return { ok: false, message: resolved.message };

  const { supabase, userId } = await requireUser();
  // CANVAS-GAP-06: a token connection is NOT required to save a calendar
  // feed URL -- migration 208 made instance_url/encrypted_token/
  // token_last4/token_status nullable specifically so this row can exist
  // for an ICS-only, genuinely no-token account. `upsert` (not `update`)
  // creates the row when none exists yet; PostgREST's upsert only touches
  // the columns present in this payload, so an EXISTING token connection's
  // instance_url/encrypted_token/token_last4/token_status are left
  // untouched when a token-connected user also saves a feed URL.
  const { error } = await supabase.from("canvas_connections").upsert(
    { user_id: userId, encrypted_ics_feed_url: encryptSecret(url), ics_feed_url_last4: last4(icsFeedDisplaySource(url)), updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, message: "Couldn't save that feed URL. Try again." };

  revalidatePath("/settings");
  return { ok: true, message: "Calendar feed saved." };
}

export interface IcsReconcileActionResult extends CanvasActionResult {
  summary?: IcsReconcileResult;
}

/** Rate-limit for the manual "Reconcile now" action (the Lead's ruling): the ICS feed is a full-term dump, not a small incremental poll. A plain cooldown timestamp, not a request-count limiter -- this is a single button one signed-in user can click, not a shared/high-volume endpoint. */
const ICS_RECONCILE_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Manually-triggered (P3-13's own scoping decision, approved by the
 * Lead) -- fetches the saved ICS feed, parses it, and reconciles against
 * the SAME dedup marker the REST grade-sync poll uses. Never returns the
 * decrypted feed URL, or any part of it, to the caller -- only a count
 * summary.
 */
export async function reconcileCanvasIcs(): Promise<IcsReconcileActionResult> {
  const { supabase, userId } = await requireUser();
  const { data } = await supabase.from("canvas_connections").select("encrypted_ics_feed_url, last_ics_reconcile_at").eq("user_id", userId).maybeSingle();
  if (!data || !data.encrypted_ics_feed_url) return { ok: false, message: "Save your Canvas calendar feed URL first." };

  if (data.last_ics_reconcile_at) {
    const elapsedMs = Date.now() - new Date(data.last_ics_reconcile_at).getTime();
    if (elapsedMs < ICS_RECONCILE_COOLDOWN_MS) {
      const waitSec = Math.ceil((ICS_RECONCILE_COOLDOWN_MS - elapsedMs) / 1000);
      return { ok: false, message: `Reconciled recently -- try again in ${waitSec}s.` };
    }
  }

  let feedUrl: string;
  try {
    feedUrl = decryptSecret(data.encrypted_ics_feed_url);
  } catch {
    return { ok: false, message: "Your saved calendar feed URL can't be read anymore. Paste it again." };
  }

  const fetchRes = await fetchCanvasIcsFeed(feedUrl);
  if (!fetchRes.ok) return { ok: false, message: fetchRes.message };

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";

  let summary: IcsReconcileResult;
  try {
    summary = await reconcileCanvasIcsCore(supabase, userId, timezone, fetchRes.data);
  } catch {
    return { ok: false, message: "Reconciliation failed unexpectedly. Try again." };
  }

  await supabase.from("canvas_connections").update({ last_ics_reconcile_at: new Date().toISOString() }).eq("user_id", userId);
  revalidatePath("/settings");
  revalidatePath("/school");

  const parts: string[] = [];
  if (summary.newlyStaged > 0) parts.push(`${summary.newlyStaged} new assignment${summary.newlyStaged === 1 ? "" : "s"} staged for your review`);
  if (summary.linkedToExisting > 0) parts.push(`${summary.linkedToExisting} matched to an assessment you already entered`);
  // CANVAS-LITE-04: the SAME honest course-import summary the token path's
  // connectCanvas/refreshCanvasCourses already show -- a no-token student
  // (whose school blocks Canvas tokens entirely) sees the exact same
  // "what happened to my classes" reporting the token path gets.
  const message =
    (parts.length === 0 ? "No new assignments found in your calendar feed." : `Found ${parts.join(" and ")}.`) + formatImportSummary(summary.courseImport);
  return { ok: true, message, summary };
}
