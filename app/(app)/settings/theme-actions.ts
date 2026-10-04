"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { updateAppearanceCore } from "@/lib/settings/actions-core";
import type { ThemePresetId } from "@/lib/theme-presets";

/**
 * Lean, absolute setter for the appearance picker (THEME-01). updateProfile upserts
 * the whole profile and revalidates the root layout, which is what made switching
 * lag; this writes ONE column and returns. The picker applies the preset to <html>
 * itself, so nothing needs to re-render for the person to see it.
 */
export async function setThemePreset(preset: ThemePresetId): Promise<void> {
  const { supabase, userId } = await requireUser();
  await updateAppearanceCore(supabase, userId, { theme_preset: preset });
}

/** Data-free cache revalidation, scheduled once per burst of preset clicks, so other routes' cached payloads carry the saved preference. */
export async function refreshThemeViews(): Promise<void> {
  await requireUser();
  revalidatePath("/", "layout");
}
