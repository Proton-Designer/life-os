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
 */
export async function getMyAiPreference(): Promise<AiPreference> {
  const { supabase, userId } = await requireUser();
  return getAiPreference(supabase, userId);
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
