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
 * ABSENCE IS THE DEFAULT, NEVER A BROKEN STATE: no row means deepseek/
 * cheap, matching this app's founding rule that every opt-in AI setting
 * degrades to its safe default rather than erroring -- a user who has
 * never opened the AI settings page gets the exact behavior this app
 * already had before multi-provider existed.
 *
 * A READ FAILURE IS NOT THE SAME THING AS "NO ROW", and this distinction
 * is load-bearing, not pedantic (found live, 2026-09-15, the Lead): if a
 * genuine read error or thrown exception silently degraded to deepseek/
 * cheap the same way an absent row does, that would REOPEN the cross-
 * provider fallback the whole multi-provider design makes impossible by
 * construction -- just through a side door. Walk it through: a user chose
 * Claude, the preferences read hits a transient DB error, "degrades
 * safely" to deepseek/cheap, and their content goes to DeepSeek -- on
 * Ayman's shared key if they're allowlisted, or their own DeepSeek key if
 * they have one -- a provider they explicitly didn't choose. So the two
 * cases return DIFFERENT shapes: `{ok:true, preference}` for a real
 * choice OR a genuinely absent one (both legitimate), `{ok:false, reason}`
 * for anything that actually failed to answer the question, which
 * `gatewayChat` must treat as a hard stop (no adapter call at all), the
 * same fail-closed posture the spend cap already uses.
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

export type AiPreferenceResult = { ok: true; preference: AiPreference } | { ok: false; reason: string };

const DEFAULT_PREFERENCE: AiPreference = { provider: "deepseek", modelTier: "cheap" };

interface AiPreferenceRow {
  provider: string;
  model_tier: string;
}

export async function getAiPreference(supabase: SupabaseClient, userId: string): Promise<AiPreferenceResult> {
  try {
    const { data, error } = await untypedFrom(supabase, "user_ai_preferences")
      .select("provider, model_tier")
      .eq("user_id", userId)
      .maybeSingle()
      .returns<AiPreferenceRow | null>();
    if (error) {
      // A genuine read failure -- fail CLOSED, not to a default. See this
      // file's own header for why a silent default here would reopen
      // cross-provider fallback through a side door.
      return { ok: false, reason: `Couldn't read your AI preference: ${error.message}` };
    }
    if (!data) {
      // Genuinely no row -- the user has never chosen. This IS the safe
      // default, not a failure.
      return { ok: true, preference: DEFAULT_PREFERENCE };
    }
    if (!isProviderId(data.provider) || (data.model_tier !== "cheap" && data.model_tier !== "capable")) {
      // A row EXISTS but doesn't parse (a hand-edited row, a provider this
      // deployed code doesn't recognize yet) -- this is a failure to
      // answer the question, not an absence, so it fails closed too rather
      // than silently substituting deepseek for whatever was actually there.
      return { ok: false, reason: "Your saved AI preference couldn't be read." };
    }
    return { ok: true, preference: { provider: data.provider, modelTier: data.model_tier } };
  } catch (e) {
    return { ok: false, reason: `Couldn't read your AI preference: ${e instanceof Error ? e.message : "unknown error"}` };
  }
}

export async function setAiPreference(supabase: SupabaseClient, userId: string, preference: AiPreference): Promise<{ ok: boolean; error?: string }> {
  const { error } = await untypedFrom(supabase, "user_ai_preferences").upsert(
    { user_id: userId, provider: preference.provider, model_tier: preference.modelTier, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
