import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "./encryption";
import { PROVIDERS, type ProviderId } from "./providers";

/**
 * Resolve the key to use for a provider, for one user.
 *
 * ORDER: the user's own key first, then a server-configured key, then null.
 *
 * The user's key wins deliberately. If a server key exists (in a deployment
 * where the operator chose to fund it), a user who supplied their own has
 * explicitly asked to spend their own quota — silently billing the operator
 * instead would be wrong in the surprising direction.
 *
 * NULL IS A COMPLETELY NORMAL RESULT and never an error. It means "this
 * enhancement is off for this user", which is the default state of the product.
 * Callers must render the feature as absent, not as broken, and must never
 * prompt the user to pay for anything.
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
      // Ciphertext we can't open — a rotated server secret, or a corrupted row.
      // Fall through to the server key rather than throwing: the user loses an
      // optional feature, which beats an error they cannot act on.
      return serverKey(provider, userId);
    }
  }
  return serverKey(provider, userId);
}

/**
 * PHASE 1 MULTI-PROVIDER (2026-09-14, Ayman's ruling via the Phase-1 lead):
 * the shared operator-funded key is an ALLOWLIST, not a fallback for
 * everyone. The DeepSeek spend cap is $1.00 LIFETIME and GLOBAL (spend-
 * cap.ts) — a stranger drawing on it doesn't just cost money, it can
 * exhaust the cap and cut off Ayman's OWN AI access. `AI_SHARED_KEY_POLICY`
 * defaults to `"allowlist"`; only `"everyone"` (explicit, opt-in) restores
 * the old fallback-for-anyone behavior.
 *
 * FAIL-SAFE BY CONSTRUCTION, not by a check that could be gotten wrong: an
 * unset or empty `AI_SHARED_KEY_ALLOWED_USER_IDS` produces an empty list,
 * and `.includes()` on an empty list is `false` for every user id — the
 * policy defaulting to "allowlist" with no list configured means NOBODY
 * gets the shared key, not everyone. There is no code path here that reads
 * an absent env var as "allow all."
 */
function sharedKeyAllowed(userId: string): boolean {
  const policy = process.env.AI_SHARED_KEY_POLICY ?? "allowlist";
  if (policy === "everyone") return true;
  const allowed = (process.env.AI_SHARED_KEY_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return allowed.includes(userId);
}

function serverKey(provider: ProviderId, userId: string): string | null {
  if (!sharedKeyAllowed(userId)) return null;
  const fromEnv = process.env[`${provider.toUpperCase()}_API_KEY`];
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

/** Does this user have an AI-backed feature available at all? */
export async function hasAiAvailable(client: SupabaseClient, userId: string): Promise<boolean> {
  return (await resolveApiKey(client, userId, "deepseek")) !== null;
}

export type KeySource = "user" | "server";

export interface ResolvedKey {
  key: string;
  /**
   * "user" = this account's own BYO key (their own DeepSeek balance, their
   * own responsibility). "server" = the operator-funded fallback key
   * (`DEEPSEEK_API_KEY`), a single shared account balance every user without
   * their own key draws from.
   *
   * THIS IS THE FIELD THE SPEND CAP KEYS OFF OF (`lib/ai/spend-cap.ts`): the
   * cap protects the shared "server" balance, never a user's own key. A
   * user's BYO key is their own money; refusing calls against it on OUR
   * ceiling would be paternalistic and would not protect anything of ours.
   */
  source: KeySource;
}

/**
 * Same resolution order as `resolveApiKey` (user key, then server key, then
 * null) but also reports WHICH one it found, for the gateway's spend cap and
 * usage log. Deliberately a separate function rather than changing
 * `resolveApiKey`'s return shape: `resolveApiKey` has existing callers
 * (`answer-feedback-actions.ts`, `api-key-actions.ts`) that only ever needed
 * the string, and changing a widely-used function's return type to grow one
 * new caller's requirement is exactly the kind of blast-radius risk this
 * codebase's own incidents warn about. New callers that need the source
 * (the gateway) call this one instead.
 */
export async function resolveApiKeyWithSource(
  client: SupabaseClient,
  userId: string,
  provider: ProviderId,
): Promise<ResolvedKey | null> {
  const { data, error } = await client
    .from("user_api_keys")
    .select("encrypted_key")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (!error && data?.encrypted_key) {
    try {
      return { key: decryptSecret(data.encrypted_key as string), source: "user" };
    } catch {
      // Same fallback posture as resolveApiKey: an unreadable ciphertext
      // falls through to the server key rather than failing the caller.
    }
  }
  const fromServer = serverKey(provider, userId);
  return fromServer ? { key: fromServer, source: "server" } : null;
}

/**
 * Reads ONLY this user's own stored key -- structurally incapable of
 * returning the shared server key, unlike `resolveApiKey`/
 * `resolveApiKeyWithSource` (both of which fall through to `serverKey()` by
 * design, for gateway-routed calls that SHOULD draw on the operator-funded
 * balance when the user has none). This function exists for exactly one
 * kind of caller: "does the key THIS USER put in THIS FORM still work" --
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
