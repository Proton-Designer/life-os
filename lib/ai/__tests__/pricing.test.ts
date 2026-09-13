import { describe, expect, it } from "vitest";
import { DEEPSEEK_PRICING_USD_PER_1M, estimateCostUsd, estimateWorstCaseCostUsd, isPeakUtc, isPricedModel } from "../pricing";

// Fixed reference points instead of `new Date()` everywhere, so this suite
// never becomes flaky at exactly 01:00/04:00/06:00/10:00 UTC or on a weekend
// run. Wednesday 2026-09-16 (an ordinary weekday, arbitrary week).
const OFF_PEAK = new Date("2026-09-16T12:00:00Z"); // 12:00 UTC, weekday, off-peak
const PEAK_MORNING = new Date("2026-09-16T02:00:00Z"); // inside 01:00-04:00
const PEAK_LATE = new Date("2026-09-16T07:00:00Z"); // inside 06:00-10:00
const SATURDAY_DURING_WOULD_BE_PEAK_HOUR = new Date("2026-09-19T02:00:00Z"); // Sat

describe("isPeakUtc()", () => {
  it("is off-peak outside both weekday windows", () => {
    expect(isPeakUtc(OFF_PEAK)).toBe(false);
  });
  it("is peak inside 01:00-04:00 UTC on a weekday", () => {
    expect(isPeakUtc(PEAK_MORNING)).toBe(true);
  });
  it("is peak inside 06:00-10:00 UTC on a weekday", () => {
    expect(isPeakUtc(PEAK_LATE)).toBe(true);
  });
  it("boundaries are half-open: 04:00 and 10:00 themselves are OFF-peak", () => {
    expect(isPeakUtc(new Date("2026-09-16T04:00:00Z"))).toBe(false);
    expect(isPeakUtc(new Date("2026-09-16T10:00:00Z"))).toBe(false);
    expect(isPeakUtc(new Date("2026-09-16T01:00:00Z"))).toBe(true);
    expect(isPeakUtc(new Date("2026-09-16T06:00:00Z"))).toBe(true);
  });
  it("weekends are ALWAYS off-peak, even during what would be a peak hour on a weekday", () => {
    expect(isPeakUtc(SATURDAY_DURING_WOULD_BE_PEAK_HOUR)).toBe(false);
  });
});

describe("isPricedModel()", () => {
  it("recognizes both real, current model ids", () => {
    expect(isPricedModel("deepseek-flash")).toBe(true);
    expect(isPricedModel("deepseek-v4-pro")).toBe(true);
  });
  it("does not recognize the retired alias or a made-up name", () => {
    expect(isPricedModel("deepseek-v4-flash")).toBe(false);
    expect(isPricedModel("gpt-4")).toBe(false);
  });
});

describe("estimateCostUsd()", () => {
  it("prices a cache-miss-only, off-peak flash call using the published per-1M rates exactly", () => {
    // 1,000,000 cache-miss input tokens + 1,000,000 output tokens, off-peak flash
    // = $0.15 + $0.60 = $0.75, exactly the published table (no rounding surprises).
    const cost = estimateCostUsd(
      "deepseek-flash",
      { promptTokens: 1_000_000, cachedPromptTokens: 0, completionTokens: 1_000_000, reasoningTokens: 0 },
      OFF_PEAK,
    );
    expect(cost).toBeCloseTo(0.15 + 0.6, 10);
  });

  it("a full cache HIT is far cheaper than a full cache miss, same model/time/token counts", () => {
    const tokens = { promptTokens: 10_000, cachedPromptTokens: 10_000, completionTokens: 0, reasoningTokens: 0 };
    const hit = estimateCostUsd("deepseek-flash", tokens, OFF_PEAK);
    const miss = estimateCostUsd("deepseek-flash", { ...tokens, cachedPromptTokens: 0 }, OFF_PEAK);
    expect(hit).toBeLessThan(miss);
    expect(hit).toBeCloseTo(miss * (DEEPSEEK_PRICING_USD_PER_1M["deepseek-flash"].cacheHitInput.offPeak / DEEPSEEK_PRICING_USD_PER_1M["deepseek-flash"].cacheMissInput.offPeak), 10);
  });

  it("peak pricing is exactly double off-peak, matching DeepSeek's own stated rule", () => {
    const tokens = { promptTokens: 500_000, cachedPromptTokens: 0, completionTokens: 500_000, reasoningTokens: 100_000 };
    const offPeak = estimateCostUsd("deepseek-v4-pro", tokens, OFF_PEAK);
    const peak = estimateCostUsd("deepseek-v4-pro", tokens, PEAK_MORNING);
    expect(peak).toBeCloseTo(offPeak * 2, 10);
  });

  it("reasoning tokens are billed as ordinary output tokens -- no separate, cheaper rate for them", () => {
    const withoutReasoning = estimateCostUsd(
      "deepseek-flash",
      { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 1000, reasoningTokens: 0 },
      OFF_PEAK,
    );
    const halfIsReasoning = estimateCostUsd(
      "deepseek-flash",
      { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 1000, reasoningTokens: 500 },
      OFF_PEAK,
    );
    // completionTokens is the SAME (1000) in both -- reasoningTokens is a
    // sub-count for reporting, not an addend, so cost must be identical.
    expect(halfIsReasoning).toBeCloseTo(withoutReasoning, 10);
  });

  it("an unpriced/unknown model id falls back to the MORE expensive priced model, never to $0", () => {
    const unknown = estimateCostUsd(
      "some-future-model-not-in-the-table",
      { promptTokens: 1000, cachedPromptTokens: 0, completionTokens: 1000, reasoningTokens: 0 },
      OFF_PEAK,
    );
    expect(unknown).toBeGreaterThan(0);
    const proCost = estimateCostUsd(
      "deepseek-v4-pro",
      { promptTokens: 1000, cachedPromptTokens: 0, completionTokens: 1000, reasoningTokens: 0 },
      OFF_PEAK,
    );
    expect(unknown).toBeCloseTo(proCost, 10);
  });
});

describe("estimateWorstCaseCostUsd()", () => {
  it("assumes zero cache hit (the more expensive case) and uses maxTokens as the completion count", () => {
    const worstCase = estimateWorstCaseCostUsd("deepseek-flash", 4000 /* chars, ~1000 tokens */, 300, OFF_PEAK);
    const exact = estimateCostUsd(
      "deepseek-flash",
      { promptTokens: 1000, cachedPromptTokens: 0, completionTokens: 300, reasoningTokens: 0 },
      OFF_PEAK,
    );
    expect(worstCase).toBeCloseTo(exact, 10);
  });
});
