import "server-only";
import { PROVIDERS, type ProviderId } from "./providers";

/**
 * A minimal OpenAI-wire chat client. DeepSeek speaks that protocol, so this is
 * a fetch and a type — no SDK, no dependency to keep current, and adding a
 * second compatible provider is a base URL.
 *
 * Every function here can fail and every caller must treat failure as "this
 * enhancement is unavailable right now", never as an error the user has to
 * resolve. The features behind this are optional by construction.
 */

export interface ChatResult {
  ok: boolean;
  content?: string;
  /** Safe to show a user. Never contains the key. */
  message?: string;
}

const TIMEOUT_MS = 20_000;

export async function chat(
  provider: ProviderId,
  apiKey: string,
  messages: { role: "system" | "user"; content: string }[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<ChatResult> {
  const { baseUrl, defaultModel, label } = PROVIDERS[provider];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: defaultModel,
        messages,
        max_tokens: opts.maxTokens ?? 300,
        temperature: opts.temperature ?? 0.2,
        stream: false,
      }),
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `${label} rejected that key. Check it's still active.` };
    }
    if (res.status === 429) {
      return { ok: false, message: `${label} says you're out of quota or rate-limited.` };
    }
    if (!res.ok) {
      // Deliberately not surfacing the provider's raw body: it can echo request
      // content, and on some providers that includes the Authorization header
      // in a debug field. Status is enough for a user to act on.
      return { ok: false, message: `${label} returned an error (HTTP ${res.status}).` };
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return { ok: false, message: `${label} returned an empty response.` };
    return { ok: true, content };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      return { ok: false, message: `${label} took too long to respond.` };
    }
    return { ok: false, message: `Couldn't reach ${label}.` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The cheapest call that proves a key works, used by "Test key" in Settings.
 *
 * Verifying at save time matters more than it looks: without it, a mistyped key
 * is stored happily and the only symptom is that an optional feature quietly
 * never appears — indistinguishable from not having enabled it. That is the
 * silent-absence failure this codebase has hit repeatedly.
 */
export async function verifyKey(provider: ProviderId, apiKey: string): Promise<ChatResult> {
  return chat(provider, apiKey, [{ role: "user", content: "Reply with the single word: ok" }], {
    maxTokens: 5,
  });
}
