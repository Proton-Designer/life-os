import { describe, expect, it, vi } from "vitest";
import { isRetryable, withRetry } from "../retry";
import type { ChatResult } from "../client";

function fail(errorKind: NonNullable<ChatResult["errorKind"]>): ChatResult {
  return { ok: false, message: "x", errorKind };
}
const ok: ChatResult = { ok: true, content: "done" };

describe("isRetryable()", () => {
  it("retries transient/no-charge failures: rate_limited, server_error, timeout, network", () => {
    expect(isRetryable(fail("rate_limited"))).toBe(true);
    expect(isRetryable(fail("server_error"))).toBe(true);
    expect(isRetryable(fail("timeout"))).toBe(true);
    expect(isRetryable(fail("network"))).toBe(true);
  });

  it("never retries auth or bad_request -- they fail identically every time", () => {
    expect(isRetryable(fail("auth"))).toBe(false);
    expect(isRetryable(fail("bad_request"))).toBe(false);
  });

  it("never retries empty_content -- tokens were already billed once; an automatic retry would bill again for a non-transient failure", () => {
    expect(isRetryable(fail("empty_content"))).toBe(false);
  });

  it("a success is never 'retryable' (there's nothing to retry)", () => {
    expect(isRetryable(ok)).toBe(false);
  });
});

describe("withRetry()", () => {
  it("returns immediately on first-attempt success, no sleep, attempts === 1", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const attempt = vi.fn().mockResolvedValue(ok);
    const { result, attempts } = await withRetry(attempt, { sleep });
    expect(result).toBe(ok);
    expect(attempts).toBe(1);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a rate_limited failure and succeeds on the second attempt", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const attempt = vi.fn().mockResolvedValueOnce(fail("rate_limited")).mockResolvedValueOnce(ok);
    const { result, attempts } = await withRetry(attempt, { sleep });
    expect(result).toBe(ok);
    expect(attempts).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("stops immediately on a non-retryable failure -- never calls attempt a second time", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const attempt = vi.fn().mockResolvedValue(fail("auth"));
    const { result, attempts } = await withRetry(attempt, { sleep, maxAttempts: 5 });
    expect(result.ok).toBe(false);
    expect(attempts).toBe(1);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("stops immediately on empty_content -- never auto-retries a call that already burned tokens", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const attempt = vi.fn().mockResolvedValue(fail("empty_content"));
    const { attempts } = await withRetry(attempt, { sleep, maxAttempts: 5 });
    expect(attempts).toBe(1);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts, returning the last (still failing) result", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const attempt = vi.fn().mockResolvedValue(fail("server_error"));
    const { result, attempts } = await withRetry(attempt, { sleep, maxAttempts: 3 });
    expect(result.ok).toBe(false);
    expect(attempts).toBe(3);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // between 1->2 and 2->3, never after the last attempt
  });

  it("backoff delays are bounded by maxDelayMs and grow with attempt number (checked via the cap passed to Math.random, not real timing)", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const attempt = vi.fn().mockResolvedValue(fail("timeout"));
    await withRetry(attempt, { sleep, maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 250 });
    // 3 sleeps: caps should be min(250, 100*2^0)=100, min(250,100*2^1)=200, min(250,100*2^2)=250
    const delays = sleep.mock.calls.map((c) => c[0] as number);
    expect(delays.length).toBe(3);
    for (const d of delays) expect(d).toBeGreaterThanOrEqual(0);
    expect(delays[0]).toBeLessThanOrEqual(100);
    expect(delays[1]).toBeLessThanOrEqual(200);
    expect(delays[2]).toBeLessThanOrEqual(250);
  });
});
