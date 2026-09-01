/**
 * The provider registry. One entry per service a user can supply a key for.
 *
 * DeepSeek is the only provider today (Ayman's ruling, replacing Anthropic):
 * it is OpenAI-wire-compatible, so the client below is a plain fetch and adding
 * a second provider later is a table entry plus a base URL, not a new SDK.
 *
 * EVERY FEATURE BEHIND A KEY IS OPTIONAL BY CONSTRUCTION. Nothing here is
 * consulted to decide whether the app works — only whether a specific
 * enhancement is offered. A user with no key sees an app with fewer features,
 * never a broken one, and is never asked to pay for anything.
 */

export const PROVIDERS = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    /** Where a user goes to create one. Shown in the UI so they aren't hunting. */
    consoleUrl: "https://platform.deepseek.com/api_keys",
    keyPrefix: "sk-",
    /** What enabling this actually unlocks, in the user's words, not ours. */
    unlocks: "Written feedback on your typed answers during a retrieval session.",
  },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

/**
 * Shape validation only — deliberately permissive.
 *
 * We check the prefix and a plausible length and nothing more. Providers change
 * key formats without notice, and a regex that is too clever rejects a VALID
 * key, which is a far worse failure than accepting an invalid one: an invalid
 * key fails a test call and says so, while a wrongly-rejected key leaves the
 * user believing the app is broken and unable to proceed at all.
 */
export function validateKeyShape(provider: ProviderId, key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return "Paste a key first.";
  if (trimmed.length < 16) return "That looks too short to be an API key.";
  if (trimmed.length > 400) return "That looks too long to be an API key.";
  if (/\s/.test(trimmed)) return "That key contains spaces — check for a copy/paste slip.";
  const { keyPrefix, label } = PROVIDERS[provider];
  if (keyPrefix && !trimmed.startsWith(keyPrefix)) {
    return `${label} keys start with "${keyPrefix}". Check you copied the whole key.`;
  }
  return null;
}
