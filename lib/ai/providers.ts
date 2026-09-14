/**
 * The provider registry. One entry per service a user can supply a key for.
 *
 * MULTI-PROVIDER (Phase 1, 2026-09-14, Ayman's request): DeepSeek was the
 * only provider through 2026-09-13 ("adding a second provider later is a
 * table entry plus a base URL, not a new SDK" -- still true for the three
 * OpenAI-wire-compatible additions below; Claude and Gemini are NOT
 * wire-compatible and need their own SDK-backed adapters, see
 * lib/ai/adapters/). `wireProtocol` is what the dispatcher in client.ts
 * reads to pick which adapter handles a given provider.
 *
 * DEEPSEEK'S OWN ENTRY IS UNCHANGED BELOW -- every existing field, every
 * existing value, byte-for-byte identical to before this pass. Only
 * `wireProtocol` (new) was added to it, which no existing code reads yet;
 * every other field a caller already depends on is untouched.
 *
 * MODEL IDS AND PRICES for the five new providers come from
 * lib/ai/model-catalog.ts, fetched from each provider's own official docs
 * on 2026-09-14 -- this file just points `defaultModel`/`models` at the
 * catalog's own ids rather than repeating them, so there is exactly one
 * place each id is spelled out.
 *
 * EVERY FEATURE BEHIND A KEY IS OPTIONAL BY CONSTRUCTION. Nothing here is
 * consulted to decide whether the app works — only whether a specific
 * enhancement is offered. A user with no key sees an app with fewer features,
 * never a broken one, and is never asked to pay for anything.
 */

import { MODEL_CATALOG } from "./model-catalog";

/** Which adapter (lib/ai/adapters/) speaks this provider's wire protocol. */
export type WireProtocol = "openai-compatible" | "anthropic" | "google";

export const PROVIDERS = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    wireProtocol: "openai-compatible" as WireProtocol,
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
  anthropic: {
    id: "anthropic",
    label: "Claude",
    // Unused by the anthropic.ts adapter (it calls @anthropic-ai/sdk, which
    // owns its own base URL) — kept for display/consistency only.
    baseUrl: "https://api.anthropic.com",
    wireProtocol: "anthropic" as WireProtocol,
    defaultModel: MODEL_CATALOG.anthropic.budget.id,
    models: {
      cheap: MODEL_CATALOG.anthropic.budget.id,
      capable: MODEL_CATALOG.anthropic.flagship.id,
    },
    // Opus 5 has thinking ON by default (the Lead's own note); adapters
    // translate the gateway's `effort` option to `output_config.effort`
    // rather than disabling thinking, which has documented failure modes
    // on this model family — see adapters/anthropic.ts.
    reasoningModel: true,
    consoleUrl: "https://console.anthropic.com/settings/keys",
    keyPrefix: "sk-ant-",
    unlocks: "Written feedback on your typed answers during a retrieval session.",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    wireProtocol: "openai-compatible" as WireProtocol,
    defaultModel: MODEL_CATALOG.openai.budget.id,
    models: {
      cheap: MODEL_CATALOG.openai.budget.id,
      capable: MODEL_CATALOG.openai.flagship.id,
    },
    reasoningModel: true,
    consoleUrl: "https://platform.openai.com/api-keys",
    keyPrefix: "sk-",
    unlocks: "Written feedback on your typed answers during a retrieval session.",
  },
  google: {
    id: "google",
    label: "Gemini",
    // Unused by the google.ts adapter (it calls @google/genai, which owns
    // its own base URL) — kept for display/consistency only.
    baseUrl: "https://generativelanguage.googleapis.com",
    wireProtocol: "google" as WireProtocol,
    defaultModel: MODEL_CATALOG.google.budget.id,
    models: {
      cheap: MODEL_CATALOG.google.budget.id,
      capable: MODEL_CATALOG.google.flagship.id,
    },
    reasoningModel: true,
    consoleUrl: "https://aistudio.google.com/apikey",
    // NOT independently verified 2026-09-14 (ai.google.dev's key-creation
    // page didn't state a prefix) — left undefined deliberately rather than
    // guessed, per validateKeyShape's own rule: a wrongly-rejected valid
    // key is worse than skipping the prefix check.
    keyPrefix: undefined as string | undefined,
    unlocks: "Written feedback on your typed answers during a retrieval session.",
  },
  moonshot: {
    id: "moonshot",
    label: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.ai/v1",
    wireProtocol: "openai-compatible" as WireProtocol,
    defaultModel: MODEL_CATALOG.moonshot.budget.id,
    models: {
      cheap: MODEL_CATALOG.moonshot.budget.id,
      capable: MODEL_CATALOG.moonshot.flagship.id,
    },
    reasoningModel: true,
    consoleUrl: "https://platform.kimi.ai/console/api-keys",
    // NOT independently verified 2026-09-14 -- same reasoning as google's.
    keyPrefix: undefined as string | undefined,
    unlocks: "Written feedback on your typed answers during a retrieval session.",
  },
  xai: {
    id: "xai",
    label: "Grok (xAI)",
    baseUrl: "https://api.x.ai/v1",
    wireProtocol: "openai-compatible" as WireProtocol,
    defaultModel: MODEL_CATALOG.xai.budget.id,
    models: {
      cheap: MODEL_CATALOG.xai.budget.id,
      capable: MODEL_CATALOG.xai.flagship.id,
    },
    reasoningModel: true,
    // Only a models-listing URL was confirmed 2026-09-14
    // (console.x.ai/team/default/models); the key-management page specifically
    // wasn't, so this points at the console root rather than a guessed path.
    consoleUrl: "https://console.x.ai",
    keyPrefix: "xai-",
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
