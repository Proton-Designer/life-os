import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "./encryption";
import { PROVIDERS, type ProviderId } from "./providers";

/**
 * Resolve the key to use for a provider, for one user: THEIR OWN, or null.
 *
 * There is no shared, operator-funded fallback (removed 2026-10-25, Ayman's ruling "no shared key, every user brings their
 * own"). It used to be an allowlist (`AI_SHARED_KEY_POLICY` / `AI_SHARED_KEY_ALLOWED_USER_IDS` + `<PROVIDER>_API_KEY`); no
 * code reads those env vars any more, so setting them does nothing.
 *
 * NULL IS A COMPLETELY NORMAL RESULT and never an error. It means "this enhancement is off for this user" (they have not
 * added a key). Callers must render the feature as absent, not as broken, and must never prompt the user to pay for anything
 * beyond adding their own provider key in Settings.
 */
export async function resolveApiKey(
  client: SupabaseClient,
  userId: string,
  provider: ProviderId,
): Promise<string | null> {
  const { data, error } = await client
    .from("user_api_keys")
    .select("encrypted_key")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  // maybeSingle, never single: "this user has no key" is the DEFAULT state of
  // the app, not an exceptional one. Using .single() here would throw PGRST116
  // on the majority of users — the exact defect that broke every brand-new
  // user's first session (see lib/self-mastery/session/build-session.ts).
  if (!error && data?.encrypted_key) {
    try {
      return decryptSecret(data.encrypted_key as string);
    } catch {
      // Ciphertext we can't open — a rotated server secret, or a corrupted row. The user loses an optional feature, which
      // beats an error they cannot act on.
      return null;
    }
  }
  return null;
}

/** Does this user have an AI-backed feature available at all? */
export async function hasAiAvailable(client: SupabaseClient, userId: string): Promise<boolean> {
  return (await resolveApiKey(client, userId, "deepseek")) !== null;
}

/** Has the person saved a key for ANY provider? (The gateway and ingestion are multi-provider; `hasAiAvailable` above only looks at DeepSeek.) Used for "connect an agent or add a key" empty states. A read error reads as no key: the hint is not an error. */
export async function hasAnyAiKey(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await client.from("user_api_keys").select("provider").eq("user_id", userId).limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}

/** Whose key a call used. Only "user" is produced now; "server" stays in the type because ai_usage_log rows written while the shared key existed carry it (and its CHECK allows it). */
export type KeySource = "user" | "server";

export interface ResolvedKey {
  key: string;
  /** Always "user" now: the account's own BYO key (their own provider balance, their own responsibility). */
  source: KeySource;
}

/**
 * Same as `resolveApiKey` but also reports which key it found, for the gateway's usage log. Deliberately a separate
 * function rather than changing `resolveApiKey`'s return shape (it has existing callers that only ever needed the string).
 */
export async function resolveApiKeyWithSource(
  client: SupabaseClient,
  userId: string,
  provider: ProviderId,
): Promise<ResolvedKey | null> {
  const key = await resolveApiKey(client, userId, provider);
  return key ? { key, source: "user" } : null;
}

/**
 * Reads ONLY this user's own stored key. (Historically this was the one resolver that could not return the shared server
 * key; that key no longer exists and `resolveApiKey` is user-only too, so the two now agree. Kept as its own function
 * because `testStoredKey` and its regression test name it.) This function exists for exactly one kind of caller: "does the key THIS USER put in THIS FORM still work" --
 * a check that must never be able to silently test (and, if ever routed
 * through a non-gateway `chat()`/`verifyKey()` call, spend against) the
 * shared balance on behalf of a user who has no key of their own.
 *
 * `app/(app)/settings/api-key-actions.ts`'s `testStoredKey()` is the one
 * caller today: it used to call `resolveApiKey()`, which returns the
 * server key whenever no user row exists -- meaning ANY signed-in user
 * (regardless of whether they'd ever saved a key; the UI's "Test key"
 * button is a client-side-only guard, not a server-side one) could trigger
 * a real, uncapped, unlogged call against the shared DeepSeek balance
 * simply by invoking this server action for a provider they had no key
 * for. Found in an adversarial verification pass, 2026-09-13. Fixed by
 * giving `testStoredKey` a function that cannot return the server key at
 * all, rather than trusting every future caller to remember not to use
 * `resolveApiKey` here -- see `lib/ai/__tests__/resolve-key.test.ts` for
 * the regression test.
 */
export async function resolveStoredUserKey(
  client: SupabaseClient,
  userId: string,
  provider: ProviderId,
): Promise<string | null> {
  const { data, error } = await client
    .from("user_api_keys")
    .select("encrypted_key")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (error || !data?.encrypted_key) return null;
  try {
    return decryptSecret(data.encrypted_key as string);
  } catch {
    // Unreadable ciphertext (a rotated server secret, a corrupted row) --
    // this path must NEVER fall through to the server key, so an unusable
    // stored key reads the same as no stored key at all, not as "try the
    // shared one instead."
    return null;
  }
}

export const DEFAULT_PROVIDER: ProviderId = "deepseek";
export { PROVIDERS };
