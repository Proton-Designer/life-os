"use server";

import bcrypt from "bcryptjs";
import { requireUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";
import type { Database } from "@/lib/supabase/database.types";
import { THEME_PRESET_IDS, isThemePresetId, type ThemePresetId } from "@/lib/theme-presets";
import { isFeatureId, type FeatureId } from "@/lib/features";

// Every user-editable profiles column. `pin` is a virtual field — a raw PIN
// gets hashed before storage, never persisted as-is.
//
// theme_preset/hidden_features (L10): a NEW migration, not yet applied at
// the time this is written — see lib/theme-presets.ts and lib/features.ts.
// Both are validated below BEFORE the upsert, the same "reject early with a
// sentence a user can act on" posture lib/mcp/tokens.ts's validateScopes
// already established — the DB's own CHECK constraints (once the migration
// lands) are defense in depth for a direct/bypassed write, not the primary
// guard for this action's normal callers.
export type ProfileUpdatable = Partial<{
  display_name: string;
  prayer_calc_method: string;
  asr_madhab: "standard" | "hanafi";
  location_lat: number;
  location_lng: number;
  location_label: string;
  timezone: string;
  pin_lock_enabled: boolean;
  pin: string;
  pin_hash: string | null;
  checkin_window_start: string;
  checkin_window_end: string;
  // checkin_interval_minutes is deliberately NOT writable: the column has had
  // no reader since the point-sample check-in model was replaced (2026-08-19),
  // and its Settings control was removed 2026-09-10. Leaving it writable would
  // let a future caller re-create a value that silently does nothing. If the
  // interval is ever made real, re-add it here in the same commit that gives
  // it a reader -- see components/settings/settings-form.tsx's Check-ins panel.
  traveling_mode: boolean;
  onboarding_completed: boolean;
  theme_preset: ThemePresetId;
  hidden_features: FeatureId[];
}>;

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$.{53}$/;

export async function updateProfile(fields: ProfileUpdatable): Promise<void> {
  const { supabase, userId } = await requireUser();

  const update: Record<string, unknown> = { ...fields };

  if ("pin" in update) {
    const rawPin = update.pin as string | undefined;
    delete update.pin;
    update.pin_hash = rawPin ? await bcrypt.hash(rawPin, 10) : null;
  }

  // Defense-in-depth: never let a direct pin_hash write persist something
  // that isn't actually a bcrypt hash (a real one is a fixed-format,
  // fixed-length string — a raw 4-6 digit PIN could never match).
  if (typeof update.pin_hash === "string" && !BCRYPT_HASH_PATTERN.test(update.pin_hash)) {
    throw new Error(
      "pin_hash must be a bcrypt hash — pass a raw PIN via the `pin` field instead, it will be hashed automatically."
    );
  }

  if ("theme_preset" in update && !isThemePresetId(update.theme_preset as string)) {
    throw new Error(`Unknown theme_preset: "${update.theme_preset}". Valid presets: ${THEME_PRESET_IDS.join(", ")}.`);
  }
  if ("hidden_features" in update) {
    const values = update.hidden_features as string[];
    const bad = values.filter((v) => !isFeatureId(v));
    if (bad.length > 0) {
      throw new Error(`Unknown feature id(s) in hidden_features: ${bad.join(", ")}.`);
    }
  }

  // Upsert, not update: a brand-new auth user has no profiles row yet
  // (nothing creates one automatically) — onboarding is what's expected to
  // create it. Update-only would silently no-op for that user.
  const { error } = await supabase
    .from("profiles")
    .upsert(
      { user_id: userId, ...update } as Database["public"]["Tables"]["profiles"]["Insert"],
      { onConflict: "user_id" }
    );
  if (error) throw error;
  revalidatePath("/settings");
  revalidatePath("/onboarding");
}
