"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { getAiPreference, setAiPreference, type AiPreference } from "@/lib/ai/preferences";
import { isProviderId, type ModelTier } from "@/lib/ai/providers";

/**
 * Which AI provider + tier this user's AI-backed features use, when they
 * have a key for more than one provider or want their DeepSeek key running
 * on the flagship model instead of the budget default. Absence (no row
 * yet) reads as deepseek/cheap — see lib/ai/preferences.ts's own header.
 *
 * This is display-only (which radio button this page pre-selects), never
 * itself a call to a provider — so unlike gatewayChat, a READ FAILURE here
 * degrades to the same deepseek/cheap default as a genuinely absent row
 * rather than failing the whole settings page. That's safe specifically
 * because nothing downstream of THIS call spends money or picks a provider
 * on a user's behalf; it only decides what the picker shows on this one
 * render, and the user's actual saved row (or lack of one) is untouched.
 */
export async function getMyAiPreference(): Promise<AiPreference> {
  const { supabase, userId } = await requireUser();
  const result = await getAiPreference(supabase, userId);
  return result.ok ? result.preference : { provider: "deepseek", modelTier: "cheap" };
}

export async function saveMyAiPreference(provider: string, modelTier: string): Promise<{ ok: boolean; message: string }> {
  if (!isProviderId(provider)) return { ok: false, message: "Unknown provider." };
  if (modelTier !== "cheap" && modelTier !== "capable") return { ok: false, message: "Unknown model tier." };
  const { supabase, userId } = await requireUser();
  const result = await setAiPreference(supabase, userId, { provider, modelTier: modelTier as ModelTier });
  if (!result.ok) return { ok: false, message: "Couldn't save that preference. Try again." };
  revalidatePath("/settings");
  revalidatePath("/personal");
  return { ok: true, message: "Preference saved." };
}
