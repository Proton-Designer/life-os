import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveStoredUserKey } from "./resolve-key";
import { checkEmbeddingSpendCap } from "./embeddings-spend";
import { computeActualEmbeddingCostUsd, estimateWorstCaseEmbeddingCostUsd, estimateTotalTokens, type EmbeddingProvider } from "./embeddings-pricing";
import { recordUsage, getDefaultUsageStore, type UsageStore } from "./usage-log";

/**
 * Real embeddings via the user's OWN provider keys (P2-13). BYOK ONLY --
 * same posture as lib/ai/transcription.ts's header states for exactly the
 * same reason: this spends the USER's own money on THEIR own key, never
 * the shared/allowlisted server key `resolveApiKey`/`resolveApiKeyWithSource`
 * fall through to. `resolveStoredUserKey` is structurally incapable of
 * returning that server key -- see its own header for why that matters.
 *
 * NOT ROUTED THROUGH gatewayChat -- that function is chat-completion-
 * shaped (a messages array in, a text completion out). This is a
 * structurally different call ("an array of texts in, an array of
 * vectors out"), the same reasoning transcription.ts's header gives for
 * being its own module.
 *
 * 384 DIMENSIONS, DELIBERATELY, TO MATCH EXISTING STORAGE: both
 * `source_chunks.embedding` and `lessons.embedding` are `vector(384)`
 * (migrations 063/064) -- already applied, already there, chosen for a
 * local sentence-transformer model this repo never shipped (security
 * reasons, ADR-003/R43). OpenAI's `text-embedding-3-small` and Google's
 * `gemini-embedding-001` BOTH support requesting a smaller output size
 * (Matryoshka Representation Learning -- the model is trained so the most
 * important information sits toward the front of the vector, so
 * truncating the tail degrades quality gracefully rather than corrupting
 * it) -- confirmed directly against each provider's current docs
 * (developers.openai.com/api/docs/guides/embeddings,
 * ai.google.dev/gemini-api/docs/embeddings; fetched 2026-09-15), not
 * carried over from training memory. 384 is within OpenAI's documented
 * 256-1536 range and Google's documented 128-3072 range, though Google's
 * own docs only call out 768/1536/3072 as "recommended" -- 384 is a
 * genuinely atypical value for that provider, flagged here rather than
 * silently assumed risk-free.
 *
 * FIXED PROVIDER PREFERENCE ORDER (the Lead's explicit ruling): OpenAI
 * first, then Google, whichever key the user actually has stored. DeepSeek
 * (the app's default chat provider) has no public embeddings API and is
 * never attempted.
 */

export const EMBEDDING_DIMENSIONS = 384;
const REQUEST_TIMEOUT_MS = 30_000;
/** Checked in this fixed order -- see this file's own header for why. */
const PROVIDER_PREFERENCE: EmbeddingProvider[] = ["openai", "google"];

function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export type EmbedClientResult =
  | { ok: true; embeddings: number[][]; promptTokens: number | null }
  | { ok: false; message: string };

/** `text-embedding-3-small`, `dimensions: EMBEDDING_DIMENSIONS` -- reports real prompt_tokens usage, unlike Gemini below. */
export async function embedWithOpenAI(apiKey: string, texts: string[]): Promise<EmbedClientResult> {
  try {
    return await withTimeout(async (signal) => {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: EMBEDDING_DIMENSIONS }),
        signal,
      });
      if (res.status === 401 || res.status === 403) return { ok: false, message: "OpenAI rejected that key." };
      if (!res.ok) return { ok: false, message: `OpenAI returned an error (HTTP ${res.status}).` };
      const data = (await res.json()) as { data?: { embedding: number[]; index: number }[]; usage?: { prompt_tokens?: number } };
      if (!data.data || data.data.length !== texts.length) {
        return { ok: false, message: "OpenAI responded, but not with the expected number of embeddings." };
      }
      // Sorted by `index` -- OpenAI's own docs do not guarantee response order matches request order.
      const embeddings = [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      return { ok: true, embeddings, promptTokens: data.usage?.prompt_tokens ?? null };
    });
  } catch (err) {
    if (isAbortError(err)) return { ok: false, message: "OpenAI didn't respond in time." };
    return { ok: false, message: "Couldn't reach OpenAI." };
  }
}

/**
 * `gemini-embedding-001`, `batchEmbedContents`, `outputDimensionality: EMBEDDING_DIMENSIONS`.
 * UNLIKE OPENAI, Gemini's embedding response does not report token usage --
 * `promptTokens: null` here, same "provider doesn't reliably report this"
 * posture transcription.ts's Gemini path already takes for audio duration;
 * the caller (getUserEmbeddings below) falls back to the pre-flight
 * worst-case estimate for the usage-log entry in that case.
 */
export async function embedWithGoogle(apiKey: string, texts: string[]): Promise<EmbedClientResult> {
  try {
    return await withTimeout(async (signal) => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: texts.map((t) => ({
              model: "models/gemini-embedding-001",
              content: { parts: [{ text: t }] },
              outputDimensionality: EMBEDDING_DIMENSIONS,
            })),
          }),
          signal,
        },
      );
      if (res.status === 401 || res.status === 403) return { ok: false, message: "Gemini rejected that key." };
      if (!res.ok) return { ok: false, message: `Gemini returned an error (HTTP ${res.status}).` };
      const data = (await res.json()) as { embeddings?: { values: number[] }[] };
      if (!data.embeddings || data.embeddings.length !== texts.length) {
        return { ok: false, message: "Gemini responded, but not with the expected number of embeddings." };
      }
      return { ok: true, embeddings: data.embeddings.map((e) => e.values), promptTokens: null };
    });
  } catch (err) {
    if (isAbortError(err)) return { ok: false, message: "Gemini didn't respond in time." };
    return { ok: false, message: "Couldn't reach Gemini." };
  }
}

const EMBED_CLIENT: Record<EmbeddingProvider, (apiKey: string, texts: string[]) => Promise<EmbedClientResult>> = {
  openai: embedWithOpenAI,
  google: embedWithGoogle,
};

export type GetUserEmbeddingsResult =
  | { status: "ok"; embeddings: number[][]; provider: EmbeddingProvider }
  /** No embeddings-capable key stored for this user -- actionable, not a failure (same posture as every other "no_key" outcome in this app: manual/degraded behavior still works, see this file's own header + P2-13's task Plan for what "degraded" means here). */
  | { status: "no_key" }
  /** A key existed and a real attempt was made (spend cap, provider error, timeout) -- distinct from `no_key` since "add a key" would be false advice to someone who already has one. */
  | { status: "unavailable"; message: string };

/**
 * The orchestrator: picks the first provider (fixed preference order) the
 * user has a stored key for, gates it against the monthly spend cap,
 * calls the real provider, and logs the real cost (falling back to the
 * pre-flight worst-case estimate only when the provider itself didn't
 * report token usage -- Gemini, see embedWithGoogle's own header). Never
 * throws -- every failure mode is a real, named `GetUserEmbeddingsResult`
 * state a caller can degrade on.
 */
export async function getUserEmbeddings(
  supabase: SupabaseClient,
  userId: string,
  texts: string[],
  opts: { store?: UsageStore; at?: Date } = {},
): Promise<GetUserEmbeddingsResult> {
  if (texts.length === 0) return { status: "ok", embeddings: [], provider: "openai" };

  const store = opts.store ?? getDefaultUsageStore();
  const now = opts.at ?? new Date();

  for (const provider of PROVIDER_PREFERENCE) {
    const apiKey = await resolveStoredUserKey(supabase, userId, provider);
    if (!apiKey) continue;

    const spendCheck = await checkEmbeddingSpendCap(supabase, userId, provider, texts, { store, at: now });
    if (!spendCheck.allowed) {
      return { status: "unavailable", message: spendCheck.reason };
    }

    const result = await EMBED_CLIENT[provider](apiKey, texts);
    if (!result.ok) {
      return { status: "unavailable", message: result.message };
    }

    // Gemini never reports usage -- fall back to the SAME worst-case token
    // estimate the pre-flight gate itself used, for both the logged token
    // count and the logged cost, rather than inventing a second estimate
    // that could disagree with the number the gate already showed the user.
    const promptTokens = result.promptTokens ?? estimateTotalTokens(texts);
    const costUsd =
      result.promptTokens !== null ? computeActualEmbeddingCostUsd(provider, result.promptTokens) : estimateWorstCaseEmbeddingCostUsd(provider, texts);

    await recordUsage(
      {
        userId,
        feature: "self_mastery_embeddings",
        provider,
        model: provider === "openai" ? "text-embedding-3-small" : "gemini-embedding-001",
        keySource: "user",
        promptText: texts.join("\n").slice(0, 500), // hashed internally by recordUsage's own store, never persisted as-is -- see UsageLogEntry's own doc comment.
        tokens: { promptTokens, cachedPromptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
        costUsd,
        succeeded: true,
        retryCount: 0,
      },
      store,
    );

    return { status: "ok", embeddings: result.embeddings, provider };
  }

  return { status: "no_key" };
}
