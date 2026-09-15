"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { encryptSecret, decryptSecret, isKeyStorageConfigured, last4 } from "@/lib/ai/encryption";
import { verifyCanvasToken, fetchCanvasCourses } from "@/lib/canvas/client";
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
    .select("instance_url, token_last4, canvas_user_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return { connected: false, instanceUrl: null, tokenLast4: null, canvasUserName: null };
  return {
    connected: true,
    instanceUrl: data.instance_url,
    tokenLast4: data.token_last4,
    canvasUserName: data.canvas_user_name,
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
 * Server-only helper: resolves the stored connection's plaintext token.
 * Never exported — every caller in this file is itself a Server Action, so
 * the plaintext never leaves this module, same discipline as
 * api-key-actions.ts's `saveApiKey`/`testStoredKey`.
 */
async function resolveStoredConnection(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
): Promise<{ instanceUrl: string; token: string } | null> {
  const { data } = await supabase
    .from("canvas_connections")
    .select("instance_url, encrypted_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return { instanceUrl: data.instance_url, token: decryptSecret(data.encrypted_token) };
}

/**
 * Live-fetches the user's active Canvas courses and upserts them into
 * canvas_course_mappings. `class_id` is deliberately absent from the
 * upsert payload — PostgREST's upsert only sets columns present in the
 * request body, so re-syncing (which happens every time this is called,
 * including automatically later from P2-22's sync-status screen) can never
 * silently null out a mapping the user already made. Only name/code (Canvas
 * facts) are refreshed; class_id (the user's own decision) is untouched.
 */
export async function refreshCanvasCourses(): Promise<CanvasActionResult> {
  const { supabase, userId } = await requireUser();
  const conn = await resolveStoredConnection(supabase, userId);
  if (!conn) return { ok: false, message: "Connect Canvas first." };

  const res = await fetchCanvasCourses(conn.instanceUrl, conn.token);
  if (!res.ok) return { ok: false, message: res.message };
  if (res.data.length === 0) return { ok: true, message: "No active courses found on Canvas." };

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
  if (error) return { ok: false, message: "Fetched courses but couldn't save them. Try again." };

  revalidatePath("/settings");
  return { ok: true, message: `Synced ${res.data.length} course${res.data.length === 1 ? "" : "s"}.` };
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
