"use server";

import bcrypt from "bcryptjs";
import { requireUser } from "@/lib/supabase/auth";
import { revalidatePath } from "next/cache";
import type { Database } from "@/lib/supabase/database.types";
import { THEME_PRESET_IDS, isThemePresetId, type ThemePresetId } from "@/lib/theme-presets";
import { isFeatureId, type FeatureId } from "@/lib/features";
import { isOptInFeatureId, type OptInFeatureId } from "@/lib/opt-in-features";

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
  // Migration 181 (P2-01, overnight run 2026-09-15). null = use the system
  // default (lib/ai/monthly-spend-cap.ts's DEFAULT_MONTHLY_SPEND_CAP_USD),
  // not "no cap" -- see that file's header. Validated below (positive-only)
  // before the upsert, same posture as theme_preset/hidden_features above;
  // the DB's own CHECK constraint is defense in depth, not the primary guard.
  ai_monthly_spend_cap_usd: number | null;
  // Migration 183 (P2-05, overnight run 2026-09-15) -- the 9:30 PM reminder
  // toggle. No app-layer validation needed: it's a plain boolean, and the
  // DB column already has a NOT NULL default.
  sleep_reminder_enabled: boolean;
  // Migration 250 (P3-05, overnight run 2026-09-15/16) -- the opposite
  // direction of hidden_features above: turns ON a new, default-OFF
  // feature rather than hiding an existing one. Shared by P3-05
  // (cards_library) and P3-11 (estimate_vs_actual, not yet built).
  enabled_features: OptInFeatureId[];
  // Migration 251 (DEEN-02) -- Deen Mode switch (lib/deen/deen-mode.ts).
  // Boolean-only (validated below). Writing it touches ONLY this column:
  // turning it off never deletes or mutates any deen data.
  deen_mode: boolean;
}>;

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$.{53}$/;

/**
 * First-use trust bug follow-up (2026-09-18, same root cause as
 * app/(app)/open/actions.ts's startDayAction): a write here that only ever
 * revalidated /settings and /onboarding left every OTHER page a same-session
 * visitor had already loaded serving a stale client Router Cache entry
 * after a profile change.
 *
 * Verified by grepping every render-path (non-/settings, non-cron) caller of
 * each column below, 2026-09-18 -- this is not a reflexive "revalidate
 * everything," it is the evidenced conclusion that nearly every writable
 * field genuinely IS read well beyond /settings:
 *   - timezone: read by nearly every page in this app (AGENTS.md's
 *     calendar-date rule is enforced everywhere).
 *   - display_name/theme_preset/hidden_features: rendered in the nav shell
 *     itself (components/shell/app-shell.tsx) -- every route shares it.
 *   - enabled_features: reaches components/self-mastery/self-mastery-
 *     library.tsx and app/(app)/personal/reflection-cards-actions.ts.
 *   - prayer_calc_method/asr_madhab/location fields/traveling_mode: reach both
 *     Home (lib/home/get-domain-snapshots.ts, get-priority-items.ts,
 *     get-day-shape.ts) and /deen.
 *   - checkin_window_start/end: reach Home's day ribbon
 *     (lib/home/get-day-shape.ts).
 *   - onboarding_completed: decides the nav shell mode itself (see
 *     app/(app)/onboarding/actions.ts's completeOnboarding, which writes
 *     this through this same function).
 * Enumerating each of those pages individually here would be both
 * incomplete today and silently wrong the next time a page starts reading
 * one of them -- the layout they all share (app/(app)/layout.tsx) is the
 * honest, maintainable unit to revalidate, and it's the Next docs' own
 * "revalidating all data" example for exactly this shape of change.
 *
 * THE EXCEPTION, and the reason this is a set rather than "always revalidate
 * the layout": pin/pin_hash/pin_lock_enabled are read only by /settings' own
 * PIN panel and the PIN-verification check, never rendered on any other
 * page. ai_monthly_spend_cap_usd is read only by /settings and
 * lib/ai/monthly-spend-cap.ts, which checks it at AI-call time inside a
 * Server Action, not through a cached page render. sleep_reminder_enabled
 * is read only by /settings and lib/notifications/sleep-reminder.ts, a cron
 * route that reads fresh from the DB on every run, never through Next's
 * cache. A write naming ONLY fields from this set has nothing to gain from
 * a layout-wide purge, which is real cost (every route below the layout
 * refetches on its next visit) — that would be the over-revalidation
 * traded for a correctness bug this file is explicitly avoiding.
 */
const SETTINGS_OR_CRON_ONLY_FIELDS: ReadonlySet<keyof ProfileUpdatable> = new Set([
  "pin",
  "pin_hash",
  "pin_lock_enabled",
  "ai_monthly_spend_cap_usd",
  "sleep_reminder_enabled",
]);

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
  if ("enabled_features" in update) {
    const values = update.enabled_features as string[];
    const bad = values.filter((v) => !isOptInFeatureId(v));
    if (bad.length > 0) {
      throw new Error(`Unknown feature id(s) in enabled_features: ${bad.join(", ")}.`);
    }
  }
  if ("deen_mode" in update && typeof update.deen_mode !== "boolean") {
    throw new Error(`deen_mode must be a boolean. Got: ${JSON.stringify(update.deen_mode)}.`);
  }
  if ("ai_monthly_spend_cap_usd" in update) {
    const cap = update.ai_monthly_spend_cap_usd as number | null;
    if (cap !== null && (!Number.isFinite(cap) || cap <= 0)) {
      throw new Error("ai_monthly_spend_cap_usd must be a positive number, or null to use the default.");
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
  // See SETTINGS_OR_CRON_ONLY_FIELDS's own header for the full reasoning:
  // any field outside that verified exception set reaches real rendered
  // content elsewhere in the app, so a same-session visitor to one of those
  // pages needs the shared layout revalidated too, not just this one.
  const touchesRenderedContentBeyondSettings = (Object.keys(fields) as (keyof ProfileUpdatable)[]).some(
    (key) => !SETTINGS_OR_CRON_ONLY_FIELDS.has(key)
  );
  if (touchesRenderedContentBeyondSettings) {
    revalidatePath("/", "layout");
  }
}
