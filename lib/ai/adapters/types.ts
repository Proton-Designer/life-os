import type { UsageTokens } from "../pricing";

/**
 * The result shape EVERY adapter (openai-compatible.ts, and the anthropic.ts/
 * google.ts adapters later slices add) must produce, unchanged from what
 * `client.ts`'s `chat()` already returned before the multi-provider pass —
 * moved here so it's the one shared contract instead of living inside the
 * openai-compatible-specific file. `client.ts` re-exports this so every
 * existing `import type { ChatResult } from "@/lib/ai/client"` site keeps
 * working with no changes.
 */
export interface ChatResult {
  ok: boolean;
  content?: string;
  /** Safe to show a user. Never contains the key. */
  message?: string;
  /**
   * Token accounting for THIS call, present whenever the provider returned
   * usage data at all (even on some failure paths, e.g. an empty-content
   * 2xx still burned tokens and must still be logged/billed). Absent only
   * when the request never reached a point where the provider could report
   * usage (network failure, timeout, 4xx before a completion was attempted).
   * `lib/ai/usage-log.ts` is the only intended consumer of this field.
   */
  usage?: UsageTokens;
  /** The model the provider actually served the request with (its own echo), when it reports one. */
  modelUsed?: string;
  /**
   * A structured failure classifier for `lib/ai/retry.ts` (and BUG-1's
   * skip-vs-fail-the-book logic, self-mastery/ingestion/llm/deepseek-
   * provider.ts's `GatewayCallFailedError`) to key off of — deliberately
   * NOT inferred by pattern-matching `message` text (a user-facing string
   * is free to reword; both retry policy and BUG-1's content-shaped-only
   * skip depend on this staying accurate). Undefined when `ok: true`.
   *
   * EVERY ADAPTER MUST MAP ITS OWN FAILURE MODES (HTTP status for
   * openai-compatible; typed SDK exceptions for anthropic.ts/google.ts)
   * onto exactly these 7 values — BUG-1's skip logic specifically depends
   * on "timeout"/"empty_content" being right for every provider, not just
   * DeepSeek.
   */
  errorKind?: "auth" | "rate_limited" | "bad_request" | "server_error" | "empty_content" | "timeout" | "network";
}
