import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { THEME_PRESET_IDS, isThemePresetId, type ThemePresetId } from "@/lib/theme-presets";
import { FEATURE_IDS, isFeatureId, type FeatureId } from "@/lib/features";

/**
 * `core(supabase, userId, ...)` extraction for the MCP write path — same
 * rule as lib/deen/actions-core.ts: NEVER calls `requireUser()`/
 * `getProfile()`/`getAuthedUser()`.
 *
 * SCOPE, DELIBERATELY NARROW (team-lead's explicit instruction): only
 * `theme_preset`/`hidden_features` on `profiles`, and `weekday_baselines`
 * on `user_settings` — the fields named directly, each with a real,
 * already-shipped UI write path this mirrors
 * (app/(app)/settings/actions.ts's `updateProfile`, app/(app)/settings/
 * weekday-baseline-actions.ts's `saveWeekdayBaselines`/
 * `clearWeekdayBaselines`).
 *
 * EVERYTHING ELSE ON `user_settings` (`daily_new_limit`,
 * `notification_enabled`, `notification_time`, `desired_retention`,
 * `ai_grading_enabled`, `session_target_minutes`) IS DELIBERATELY NOT
 * WIRED HERE — checked, not assumed: grepped every `.tsx`/`.ts` file for
 * each column name and found ZERO write paths anywhere in the app. Only
 * `build-session.ts`'s ensure-insert (defaults on first session) and
 * plain reads touch them; `weekday_baselines` is the ONE field on this
 * table an actual Settings UI lets a user edit. Wiring the rest here would
 * make MCP the FIRST place these become writable at all — not extending
 * an existing reachable-but-not-yet-MCP-exposed capability, which is a
 * materially different (and bigger) decision than the one asked for.
 * Flagged to the lead rather than guessed at.
 *
 * `user_api_keys` HAS NO write action ANYWHERE in this program, and it is
 * not an oversight — see settings.api_key's own registry.ts comment: a
 * model that can write a provider key could exfiltrate one by writing a
 * key it controls, and the whole point of storing these encrypted is that
 * nothing short of the app's own verified provider round trip should ever
 * accept one. That is a permanent exclusion, not a "not yet."
 */

/**
 * Rejects LOUDLY rather than silently dropping — deliberately NOT
 * `sanitizeHiddenFeatures` (lib/features.ts), which filters out anything
 * invalid for a defensive READ (a stale DB value from a retired module).
 * A WRITE that silently dropped "home" from the array and reported success
 * would look like the tool worked while quietly ignoring half the input —
 * the same posture this program took on `checkin_allocations`' "wasted"
 * key (lib/checkins/actions-core.ts): refuse first, with a clear,
 * self-correcting message, never coerce.
 */
function validateHiddenFeatures(value: unknown): FeatureId[] {
  if (!Array.isArray(value)) {
    throw new Error(`patch.hidden_features must be an array of feature ids. Got: ${JSON.stringify(value)}.`);
  }
  const clean: FeatureId[] = [];
  for (const v of value) {
    if (typeof v !== "string") {
      throw new Error(`patch.hidden_features must contain only strings. Got: ${JSON.stringify(v)}.`);
    }
    if (v === "home" || v === "settings") {
      throw new Error(
        `"${v}" can never be hidden — this is deliberate, not a bug. Home is the anchor page (nothing else guarantees a way back to it), and Settings is the ONLY place a hidden feature gets turned back on, so hiding either would be a self-inflicted lockout.`,
      );
    }
    if (!isFeatureId(v)) {
      throw new Error(`"${v}" is not a real feature id. Valid: ${FEATURE_IDS.join(", ")}.`);
    }
    clean.push(v);
  }
  return clean;
}

function validateThemePreset(value: unknown): ThemePresetId {
  if (typeof value !== "string" || !isThemePresetId(value)) {
    throw new Error(`patch.theme_preset must be one of: ${THEME_PRESET_IDS.join(", ")}. Got: ${JSON.stringify(value)}.`);
  }
  return value;
}

export interface UpdateAppearanceResult {
  theme_preset?: ThemePresetId;
  hidden_features?: FeatureId[];
}

/**
 * Same upsert-not-update shape as `updateProfile` — a brand-new account
 * that hasn't finished onboarding may have no `profiles` row yet, and an
 * update-only write would silently no-op for it.
 */
export async function updateAppearanceCore(
  supabase: SupabaseClient,
  userId: string,
  patch: { theme_preset?: unknown; hidden_features?: unknown },
): Promise<UpdateAppearanceResult> {
  const update: Record<string, unknown> = {};
  if (patch.theme_preset !== undefined) update.theme_preset = validateThemePreset(patch.theme_preset);
  if (patch.hidden_features !== undefined) update.hidden_features = validateHiddenFeatures(patch.hidden_features);
  if (Object.keys(update).length === 0) {
    throw new Error("Provide at least one of patch.theme_preset or patch.hidden_features.");
  }

  const { error } = await supabase.from("profiles").upsert({ user_id: userId, ...update }, { onConflict: "user_id" });
  if (error) throw error;
  return update as UpdateAppearanceResult;
}

/**
 * Mirrors `saveWeekdayBaselines` exactly, including its validation
 * (exactly 7 whole-number hours, 0-12).
 */
export async function setWeekdayBaselinesCore(supabase: SupabaseClient, userId: string, values: unknown): Promise<{ values: number[] }> {
  if (!Array.isArray(values) || values.length !== 7) {
    throw new Error("patch.values must be an array of exactly 7 numbers (hours 0-12), one per weekday starting Sunday.");
  }
  for (const v of values) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 12) {
      throw new Error(`Each day must be a whole number of hours from 0 to 12. Got: ${JSON.stringify(v)}.`);
    }
  }

  const { error } = await supabase.from("user_settings").update({ weekday_baselines: values }).eq("user_id", userId);
  if (error) throw error;
  return { values: values as number[] };
}

/**
 * Mirrors `clearWeekdayBaselines` exactly — sets NULL, never a week of
 * zeros. "Never set" and "seven deliberate rest days" are different real
 * states (weekday-baseline-actions.ts's own header comment); this is the
 * only path that produces the first one.
 */
export async function clearWeekdayBaselinesCore(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase.from("user_settings").update({ weekday_baselines: null }).eq("user_id", userId);
  if (error) throw error;
}
