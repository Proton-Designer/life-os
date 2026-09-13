import "server-only";
import type { ChatResult } from "./client";

/**
 * Structured retry policy for gateway calls.
 *
 * WHICH FAILURES ARE RETRYABLE, AND WHY EACH ONE:
 *
 *   rate_limited (429)  RETRY.  DeepSeek rejected the request before running
 *                        it -- no tokens were billed, so a retry costs
 *                        latency, not money twice.
 *   server_error (5xx)  RETRY.  A 5xx means DeepSeek's own infrastructure
 *                        failed to complete the request; in the OpenAI-wire
 *                        convention this also means no usable completion was
 *                        billed. Bounded attempts, exponential backoff.
 *   timeout             RETRY.  We aborted the socket ourselves after
 *                        TIMEOUT_MS with no response at all -- we genuinely
 *                        do not know whether DeepSeek billed anything, but a
 *                        request that never returned is the case retrying is
 *                        FOR. Bounded, because a call that times out once
 *                        under real load may time out again.
 *   network             RETRY.  fetch() threw before any HTTP response
 *                        existed (DNS, TLS, connection reset) -- nothing was
 *                        billed because nothing reached DeepSeek's model.
 *
 *   auth (401/403)       NEVER RETRY.  The key is wrong. It will be wrong on
 *                        attempt 2 exactly as it was on attempt 1.
 *   bad_request (400)    NEVER RETRY.  A malformed request / bad model id
 *                        fails identically every time; retrying just delays
 *                        the caller from finding out.
 *   empty_content        NEVER RETRY, AND THIS IS THE ONE THAT COSTS MONEY
 *                        IF GOTTEN WRONG. A 2xx with empty content means
 *                        DeepSeek ALREADY RAN the model and ALREADY BILLED
 *                        the completion tokens (frequently ALL of them, on
 *                        reasoning) -- retrying blind would spend real money
 *                        a second time chasing a failure that is about the
 *                        prompt/token-budget shape, not a transient fault,
 *                        and is not guaranteed to go away on attempt 2.
 *                        Callers that hit this should widen `maxTokens` or
 *                        disable thinking mode and issue a NEW, deliberate
 *                        call — never an automatic retry of the same one.
 */
const RETRYABLE_KINDS: ReadonlySet<NonNullable<ChatResult["errorKind"]>> = new Set([
  "rate_limited",
  "server_error",
  "timeout",
  "network",
]);

export function isRetryable(result: ChatResult): boolean {
  if (result.ok) return false;
  return !!result.errorKind && RETRYABLE_KINDS.has(result.errorKind);
}

export interface RetryOptions {
  /** Total attempts including the first — NOT the number of retries. Default 3. */
  maxAttempts?: number;
  /** Base delay for exponential backoff, ms. Default 500. */
  baseDelayMs?: number;
  /** Upper bound on any single backoff delay, ms. Default 8000. */
  maxDelayMs?: number;
  /** Injectable for tests — never real timers in the mock-provider suite. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `attempt()` up to `maxAttempts` times, stopping at the first success
 * OR the first non-retryable failure, backing off exponentially (with full
 * jitter) between retryable failures.
 *
 * `attempt` takes the 1-based attempt number so a caller's own telemetry
 * (and the gateway's usage-log `retry_count`) can record how many tries a
 * result took.
 */
export async function withRetry(
  attempt: (attemptNumber: number) => Promise<ChatResult>,
  opts: RetryOptions = {},
): Promise<{ result: ChatResult; attempts: number }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 8000;
  const sleep = opts.sleep ?? defaultSleep;

  let lastResult: ChatResult = { ok: false, message: "no attempt was made", errorKind: "network" };
  for (let n = 1; n <= maxAttempts; n++) {
    lastResult = await attempt(n);
    if (lastResult.ok || !isRetryable(lastResult) || n === maxAttempts) {
      return { result: lastResult, attempts: n };
    }
    // Full jitter (AWS's "Exponential Backoff And Jitter"): a random delay in
    // [0, cap] rather than a fixed exponential value, so N concurrent callers
    // retrying the same transient outage don't all retry in lockstep.
    const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (n - 1));
    await sleep(Math.random() * cap);
  }
  return { result: lastResult, attempts: maxAttempts };
}
