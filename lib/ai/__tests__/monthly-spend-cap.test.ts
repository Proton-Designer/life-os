import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_MONTHLY_SPEND_CAP_USD,
  monthWindowUtc,
  resolveMonthlySpendCapContext,
  checkMonthlySpendCap,
} from "../monthly-spend-cap";
import { FakeUsageStore } from "./fake-usage-store";

function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(resolvedValue));
  return chain;
}

function clientWith(resolvedValue: { data: unknown; error: unknown }): SupabaseClient {
  const chain = makeChain(resolvedValue);
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

describe("monthWindowUtc()", () => {
  it("America/Chicago (UTC-5 in September, CDT): local month start is 05:00 UTC on the 1st", () => {
    const { startUtc, endUtc, monthKey } = monthWindowUtc(new Date("2026-09-15T12:00:00Z"), "America/Chicago");
    expect(monthKey).toBe("2026-09");
    expect(startUtc.toISOString()).toBe("2026-09-01T05:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-10-01T05:00:00.000Z");
  });

  it("a UTC-behind timezone's local month can start on a different UTC calendar date than 'the 1st'", () => {
    // America/Los_Angeles (UTC-7 in September, PDT): Sep 1 00:00 local is Sep 1 07:00 UTC.
    const { startUtc } = monthWindowUtc(new Date("2026-09-30T23:00:00Z"), "America/Los_Angeles");
    expect(startUtc.toISOString()).toBe("2026-09-01T07:00:00.000Z");
  });

  it("a UTC-ahead timezone crosses the UTC month boundary EARLY -- 'now' still in UTC-August can already be in local September", () => {
    // Asia/Tokyo (UTC+9): Sep 1 00:00 JST is Aug 31 15:00 UTC.
    const now = new Date("2026-08-31T20:00:00Z"); // 05:00 JST on Sep 1
    const { startUtc, monthKey } = monthWindowUtc(now, "Asia/Tokyo");
    expect(monthKey).toBe("2026-09");
    expect(startUtc.toISOString()).toBe("2026-08-31T15:00:00.000Z");
  });

  it("DST-crossing month (America/Chicago falls back at 2am on Nov 1, 2026): the window spans the change and each boundary resolves its OWN correct offset, not one reused offset", () => {
    // Nov 1 2026 00:00 is still CDT (UTC-5) -- the fall-back happens AT 2am
    // that same day, not at midnight -- so November's window OPENS at
    // UTC-5 (05:00 UTC) but CLOSES (Dec 1 00:00, now CST) at UTC-6 (06:00
    // UTC). A naive "reuse one offset for the whole window" bug would
    // compute Dec 1 05:00 UTC instead -- wrong by exactly the DST hour.
    const { startUtc, endUtc } = monthWindowUtc(new Date("2026-11-15T12:00:00Z"), "America/Chicago");
    expect(startUtc.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-12-01T06:00:00.000Z");
  });

  it("December rolls over into next January, not month 13", () => {
    const { endUtc, monthKey } = monthWindowUtc(new Date("2026-12-15T12:00:00Z"), "UTC");
    expect(monthKey).toBe("2026-12");
    expect(endUtc.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("resolveMonthlySpendCapContext()", () => {
  it("a real row with a set cap: returns its own timezone and cap", async () => {
    const supabase = clientWith({ data: { timezone: "America/Chicago", ai_monthly_spend_cap_usd: 25 }, error: null });
    const result = await resolveMonthlySpendCapContext(supabase, "u1");
    expect(result).toEqual({ ok: true, timezone: "America/Chicago", capUsd: 25 });
  });

  it("a real row with a NULL cap: returns the system default, not zero/unlimited", async () => {
    const supabase = clientWith({ data: { timezone: "America/Chicago", ai_monthly_spend_cap_usd: null }, error: null });
    const result = await resolveMonthlySpendCapContext(supabase, "u1");
    expect(result).toEqual({ ok: true, timezone: "America/Chicago", capUsd: DEFAULT_MONTHLY_SPEND_CAP_USD });
  });

  it("genuinely NO profile row: degrades to UTC + the system default (not a failure -- see this file's own header)", async () => {
    const supabase = clientWith({ data: null, error: null });
    const result = await resolveMonthlySpendCapContext(supabase, "u1");
    expect(result).toEqual({ ok: true, timezone: "UTC", capUsd: DEFAULT_MONTHLY_SPEND_CAP_USD });
  });

  it("THE REGRESSION GUARD: a genuine read error fails CLOSED, not to a default", async () => {
    const supabase = clientWith({ data: null, error: { message: "connection reset" } });
    const result = await resolveMonthlySpendCapContext(supabase, "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("connection reset");
  });

  it("a thrown exception also fails CLOSED, not silently to a default", async () => {
    const supabase = { from: () => { throw new Error("boom"); } } as unknown as SupabaseClient;
    const result = await resolveMonthlySpendCapContext(supabase, "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("boom");
  });

  it("a stored non-positive cap (data corruption) falls back to the system default rather than always-blocking or going unlimited", async () => {
    const supabase = clientWith({ data: { timezone: "UTC", ai_monthly_spend_cap_usd: -5 }, error: null });
    const result = await resolveMonthlySpendCapContext(supabase, "u1");
    expect(result).toEqual({ ok: true, timezone: "UTC", capUsd: DEFAULT_MONTHLY_SPEND_CAP_USD });
  });
});

describe("checkMonthlySpendCap()", () => {
  const NOW = new Date("2026-09-15T12:00:00Z");

  it("THE REGRESSION GUARD: a real, larger book/feature at low usage is NOT blocked -- well under the default cap", async () => {
    const supabase = clientWith({ data: { timezone: "America/Chicago", ai_monthly_spend_cap_usd: null }, error: null });
    const store = new FakeUsageStore();
    const result = await checkMonthlySpendCap(supabase, "u1", "deepseek", "deepseek-flash", 500, 300, { store, at: NOW });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.capUsd).toBe(DEFAULT_MONTHLY_SPEND_CAP_USD);
  });

  it("THE REGRESSION GUARD: spend already at the cap this month blocks the next call, before any provider call would happen", async () => {
    const supabase = clientWith({ data: { timezone: "UTC", ai_monthly_spend_cap_usd: 5 }, error: null });
    const store = new FakeUsageStore();
    store.seed(
      { userId: "u1", feature: "x", provider: "deepseek", model: "deepseek-flash", keySource: "server", promptText: "p", tokens: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, reasoningTokens: 0 }, costUsd: 5, succeeded: true, retryCount: 0 },
      new Date("2026-09-10T00:00:00Z"),
    );
    const result = await checkMonthlySpendCap(supabase, "u1", "deepseek", "deepseek-flash", 500, 300, { store, at: NOW });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("2026-09");
      expect(result.contextFailure).not.toBe(true);
    }
  });

  it("month rollover: spend recorded in LAST month's window does not count against THIS month's cap", async () => {
    const supabase = clientWith({ data: { timezone: "UTC", ai_monthly_spend_cap_usd: 5 }, error: null });
    const store = new FakeUsageStore();
    store.seed(
      { userId: "u1", feature: "x", provider: "deepseek", model: "deepseek-flash", keySource: "server", promptText: "p", tokens: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, reasoningTokens: 0 }, costUsd: 5, succeeded: true, retryCount: 0 },
      new Date("2026-08-31T23:59:59Z"), // last instant of AUGUST in UTC
    );
    const result = await checkMonthlySpendCap(supabase, "u1", "deepseek", "deepseek-flash", 500, 300, { store, at: NOW });
    expect(result.allowed).toBe(true);
  });

  it("month rollover in a non-UTC timezone: a row timestamped in UTC-August but already LOCAL-September (Asia/Tokyo) DOES count against this month", async () => {
    const supabase = clientWith({ data: { timezone: "Asia/Tokyo", ai_monthly_spend_cap_usd: 5 }, error: null });
    const store = new FakeUsageStore();
    store.seed(
      { userId: "u1", feature: "x", provider: "deepseek", model: "deepseek-flash", keySource: "server", promptText: "p", tokens: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, reasoningTokens: 0 }, costUsd: 5, succeeded: true, retryCount: 0 },
      new Date("2026-08-31T20:00:00Z"), // 05:00 JST Sep 1 -- local September already
    );
    const result = await checkMonthlySpendCap(supabase, "u1", "deepseek", "deepseek-flash", 500, 300, { store, at: new Date("2026-09-05T00:00:00Z") });
    expect(result.allowed).toBe(false);
  });

  it("THE REGRESSION GUARD: a context resolution failure fails CLOSED and is distinguishable via contextFailure", async () => {
    const supabase = clientWith({ data: null, error: { message: "connection reset" } });
    const store = new FakeUsageStore();
    const result = await checkMonthlySpendCap(supabase, "u1", "deepseek", "deepseek-flash", 500, 300, { store, at: NOW });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.contextFailure).toBe(true);
      expect(result.reason).toContain("connection reset");
    }
  });

  it("a user's own key spend counts against their own cap (key-source-agnostic, unlike the global cap)", async () => {
    const supabase = clientWith({ data: { timezone: "UTC", ai_monthly_spend_cap_usd: 1 }, error: null });
    const store = new FakeUsageStore();
    store.seed(
      { userId: "u1", feature: "x", provider: "anthropic", model: "claude", keySource: "user", promptText: "p", tokens: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, reasoningTokens: 0 }, costUsd: 1, succeeded: true, retryCount: 0 },
      new Date("2026-09-10T00:00:00Z"),
    );
    const result = await checkMonthlySpendCap(supabase, "u1", "deepseek", "deepseek-flash", 500, 300, { store, at: NOW });
    expect(result.allowed).toBe(false);
  });

  it("only counts THIS user's spend, not other users' rows in the same month", async () => {
    const supabase = clientWith({ data: { timezone: "UTC", ai_monthly_spend_cap_usd: 1 }, error: null });
    const store = new FakeUsageStore();
    store.seed(
      { userId: "someone-else", feature: "x", provider: "deepseek", model: "deepseek-flash", keySource: "server", promptText: "p", tokens: { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, reasoningTokens: 0 }, costUsd: 100, succeeded: true, retryCount: 0 },
      new Date("2026-09-10T00:00:00Z"),
    );
    const result = await checkMonthlySpendCap(supabase, "u1", "deepseek", "deepseek-flash", 500, 300, { store, at: NOW });
    expect(result.allowed).toBe(true);
  });
});
