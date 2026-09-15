import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isProviderId, type ProviderId, type ModelTier } from "./providers";

/**
 * Which AI provider + tier a user has chosen (migration 173's
 * `user_ai_preferences`), read fresh on every call rather than cached --
 * this table is a single small row per user, and staleness here would mean
 * a feature silently keeps using a provider/tier the user just switched
 * away from.
 *
 * ABSENCE IS THE DEFAULT, NEVER A BROKEN STATE: no row means
 * deepseek/cheap, matching this app's founding rule that every opt-in AI
 * setting degrades to its safe default rather than erroring -- a user who
 * has never opened the AI settings page gets the exact behavior this app
 * already had before multi-provider existed.
 *
 * UNTYPED TABLE ACCESS: `user_ai_preferences` isn't in generated
 * database.types.ts yet (migration 173 not applied at the time this file
 * was written) -- same escape hatch lib/self-mastery/untyped-from.ts
 * already established for the same reason, kept local to lib/ai rather
 * than importing across a domain boundary. Delete this local helper and
 * swap for a plain `supabase.from` the moment types are regenerated.
 */
function untypedFrom(supabase: SupabaseClient, table: string) {
  return (supabase as unknown as { from: (t: string) => ReturnType<SupabaseClient["from"]> }).from(table);
}

export interface AiPreference {
  provider: ProviderId;
  modelTier: ModelTier;
}

const DEFAULT_PREFERENCE: AiPreference = { provider: "deepseek", modelTier: "cheap" };

interface AiPreferenceRow {
  provider: string;
  model_tier: string;
}

export async function getAiPreference(supabase: SupabaseClient, userId: string): Promise<AiPreference> {
  const { data, error } = await untypedFrom(supabase, "user_ai_preferences")
    .select("provider, model_tier")
    .eq("user_id", userId)
    .maybeSingle()
    .returns<AiPreferenceRow | null>();
  // Fails CLOSED to the default, never throws -- a query error (including
  // "table doesn't exist yet" before 173 is applied) must never break a
  // caller that just wants to know which provider to use; the safe default
  // is a completely normal answer, not a degraded one.
  if (error || !data) return DEFAULT_PREFERENCE;
  if (!isProviderId(data.provider) || (data.model_tier !== "cheap" && data.model_tier !== "capable")) {
    // A row exists but fails validation (a hand-edited row, a future
    // provider this deployed code doesn't know about yet) -- same
    // fail-closed posture, not a thrown error a page would have to catch.
    return DEFAULT_PREFERENCE;
  }
  return { provider: data.provider, modelTier: data.model_tier };
}

export async function setAiPreference(supabase: SupabaseClient, userId: string, preference: AiPreference): Promise<{ ok: boolean; error?: string }> {
  const { error } = await untypedFrom(supabase, "user_ai_preferences").upsert(
    { user_id: userId, provider: preference.provider, model_tier: preference.modelTier, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
