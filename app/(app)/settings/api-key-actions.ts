"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { encryptSecret, isKeyStorageConfigured, last4 } from "@/lib/ai/encryption";
import { verifyKey } from "@/lib/ai/client";
import { isProviderId, validateKeyShape, type ProviderId } from "@/lib/ai/providers";

/**
 * Bring-your-own-key management.
 *
 * THE ONE RULE THIS FILE ENFORCES: no function here ever returns a key, in any
 * form, to anything that reaches a browser. `KeyStatus` carries the last four
 * characters and nothing else — enough for a person to recognise which key is
 * stored, useless to anyone who intercepts it. The plaintext exists only inside
 * `saveApiKey`'s own stack frame, for as long as it takes to verify and encrypt.
 */

export interface KeyStatus {
  provider: ProviderId;
  last4: string;
  label: string | null;
  addedAt: string;
}

export interface KeyActionResult {
  ok: boolean;
  message: string;
}

/** What the Settings UI renders. Deliberately cannot express a full key. */
export async function getApiKeyStatuses(): Promise<KeyStatus[]> {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase
    .from("user_api_keys")
    .select("provider, key_last4, label, created_at")
    .eq("user_id", userId);
  if (error || !data) return [];
  return data
    .filter((r) => isProviderId(r.provider as string))
    .map((r) => ({
      provider: r.provider as ProviderId,
      last4: r.key_last4 as string,
      label: (r.label as string | null) ?? null,
      addedAt: r.created_at as string,
    }));
}

/**
 * Verify the key with the provider BEFORE storing it.
 *
 * Storing first and discovering later is the worse order by a wide margin: a
 * mistyped key would sit there looking configured while the feature it unlocks
 * silently never appears — indistinguishable, from the user's side, from never
 * having enabled it. Silent absence is the failure this codebase keeps finding,
 * and it is worst when the user believes they already fixed it.
 */
export async function saveApiKey(provider: string, rawKey: string, label?: string): Promise<KeyActionResult> {
  if (!isProviderId(provider)) return { ok: false, message: "Unknown provider." };
  if (!isKeyStorageConfigured()) {
    return {
      ok: false,
      message: "Key storage isn't configured on this deployment, so a key can't be saved securely yet.",
    };
  }

  const key = rawKey.trim();
  const shapeError = validateKeyShape(provider, key);
  if (shapeError) return { ok: false, message: shapeError };

  const check = await verifyKey(provider, key);
  if (!check.ok) return { ok: false, message: check.message ?? "That key didn't work." };

  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("user_api_keys").upsert(
    {
      user_id: userId,
      provider,
      encrypted_key: encryptSecret(key),
      key_last4: last4(key),
      label: label?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
  if (error) return { ok: false, message: "Couldn't save that key. Try again." };

  revalidatePath("/settings");
  revalidatePath("/personal");
  return { ok: true, message: "Key saved and verified." };
}

/** Removing must be as easy as adding, and must actually delete the row. */
export async function removeApiKey(provider: string): Promise<KeyActionResult> {
  if (!isProviderId(provider)) return { ok: false, message: "Unknown provider." };
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from("user_api_keys")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) return { ok: false, message: "Couldn't remove that key. Try again." };
  revalidatePath("/settings");
  revalidatePath("/personal");
  return { ok: true, message: "Key removed. The features it enabled are switched off." };
}

/** Re-check a stored key without the user re-pasting it. Keys get revoked. */
export async function testStoredKey(provider: string): Promise<KeyActionResult> {
  if (!isProviderId(provider)) return { ok: false, message: "Unknown provider." };
  const { supabase, userId } = await requireUser();
  const { resolveApiKey } = await import("@/lib/ai/resolve-key");
  const key = await resolveApiKey(supabase, userId, provider);
  if (!key) return { ok: false, message: "No key stored for this provider." };
  const check = await verifyKey(provider, key);
  return check.ok
    ? { ok: true, message: "Key is working." }
    : { ok: false, message: check.message ?? "That key isn't working anymore." };
}
