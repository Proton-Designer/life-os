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
    // CORRECTED 2026-09-13 (E1, LLM gateway build). The previous comment here
    // claimed "deepseek-v4-flash" was "A LISTED name, not a bet on an alias" --
    // that was false. Fetched DeepSeek's live Models & Pricing page directly
    // (https://api-docs.deepseek.com/quick_start/pricing) while building the
    // gateway: `GET /models` with a real key returns exactly TWO models,
    // `deepseek-flash` and `deepseek-v4-pro`. The page's own footnote (1)
    // confirms it: "deepseek-v4-flash" and "deepseek-v4-flash-vision-exp" are
    // LEGACY names, still ACCEPTED for backward compatibility, silently
    // routed to DeepSeek-V4.1-Flash and billed at the flash price -- i.e.
    // this constant was working only because it happened to alias, exactly
    // the bet the old comment insisted it wasn't making. `deepseek-flash` is
    // the real, current, listed name; use it directly rather than riding a
    // compatibility shim DeepSeek could retire without notice.
    //
    // Both live models default to THINKING (reasoning) mode -- see
    // https://api-docs.deepseek.com/guides/thinking_mode. That's what broke
    // verifyKey() (lib/ai/client.ts): a trivial call with a small max_tokens
    // spent nearly the whole budget on hidden reasoning_content, leaving an
    // empty `content` that read as "key invalid." Fixed at the call site by
    // passing `{ thinking: { type: "disabled" } }` for calls that don't need
    // it (see `chat()`'s `thinking` option) rather than by padding max_tokens
    // and hoping reasoning finishes in time.
    //
    // flash, not pro, as the default/cheap tier: nobody pays pro rates to
    // learn their key works, and every interactive call today (verifyKey,
    // answer feedback) is exactly that kind of call.
    defaultModel: "deepseek-flash",
    /**
     * Model tiering (Phase 1 LLM gateway). `cheap` is the default for
     * anything interactive or speculative (verifyKey, per-answer feedback) --
     * with a $1.98 total account balance at the time this was built,
     * tiering is the difference between the gateway working at all and
     * draining the account on its first real feature. `capable` is opt-in,
     * for work that genuinely benefits from deepseek-v4-pro's reasoning over
     * deepseek-flash's -- nothing calls it by default yet.
     */
    models: {
      cheap: "deepseek-flash",
      capable: "deepseek-v4-pro",
    },
    /**
     * Both models are reasoning models (thinking mode on by default).
     * Consulted by `chat()`/the gateway to decide whether to explicitly
     * disable thinking mode for a call that doesn't need it, and by
     * `verifyKey()` to explain why a floor on the visible-content budget
     * matters here in a way it wouldn't for a non-reasoning model.
     */
    reasoningModel: true,
    /** Where a user goes to create one. Shown in the UI so they aren't hunting. */
    consoleUrl: "https://platform.deepseek.com/api_keys",
    keyPrefix: "sk-",
    /** What enabling this actually unlocks, in the user's words, not ours. */
    unlocks: "Written feedback on your typed answers during a retrieval session.",
  },
} as const;

/** Which tiering key names `models` supports. Shared by the registry and the gateway. */
export type ModelTier = "cheap" | "capable";

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
