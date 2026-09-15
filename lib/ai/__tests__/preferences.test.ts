import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAiPreference, setAiPreference } from "../preferences";

function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    chain[method] = vi.fn(() => chain);
  }
  // preferences.ts's own chain ends `.maybeSingle().returns<T>()` -- `.returns`
  // is the terminal call that actually resolves, same as get-book-detail.test.ts's
  // own makeChain for the same real Supabase chaining shape.
  chain.returns = vi.fn(() => Promise.resolve(resolvedValue));
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

/**
 * getAiPreference's whole reason to exist (2026-09-15, the Lead's fix): a
 * genuinely absent row and a genuine read failure MUST return distinguishable
 * shapes, not both collapse into the safe deepseek/cheap default -- see this
 * function's own header in lib/ai/preferences.ts for the full incident this
 * guards against (a silent read-failure default would reopen cross-provider
 * fallback through a side door). gatewayChat (gateway.test.ts) relies on
 * exactly this distinction to fail closed on a read error.
 */
describe("getAiPreference", () => {
  it("no row (maybeSingle finds nothing): ok:true, deepseek/cheap default", async () => {
    const chain = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const result = await getAiPreference(client, "user-1");
    expect(result).toEqual({ ok: true, preference: { provider: "deepseek", modelTier: "cheap" } });
  });

  it("a real saved row: ok:true, exactly that provider/tier -- never silently substituted", async () => {
    const chain = makeChain({ data: { provider: "anthropic", model_tier: "capable" }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const result = await getAiPreference(client, "user-1");
    expect(result).toEqual({ ok: true, preference: { provider: "anthropic", modelTier: "capable" } });
  });

  it("THE REGRESSION GUARD: a resolved query error is ok:false, NOT the deepseek/cheap default", async () => {
    const chain = makeChain({ data: null, error: { message: "connection reset" } });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const result = await getAiPreference(client, "user-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("connection reset");
  });

  it("THE REGRESSION GUARD: a thrown exception is ok:false, NOT the deepseek/cheap default", async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error("network unreachable");
      }),
    } as unknown as SupabaseClient;

    const result = await getAiPreference(client, "user-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("network unreachable");
  });

  it("a row that fails to parse (unrecognized provider) is ok:false, not silently coerced to deepseek", async () => {
    const chain = makeChain({ data: { provider: "not-a-real-provider", model_tier: "cheap" }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const result = await getAiPreference(client, "user-1");
    expect(result.ok).toBe(false);
  });

  it("a row that fails to parse (unrecognized tier) is ok:false, not silently coerced to cheap", async () => {
    const chain = makeChain({ data: { provider: "openai", model_tier: "ultra" }, error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const result = await getAiPreference(client, "user-1");
    expect(result.ok).toBe(false);
  });
});

describe("setAiPreference", () => {
  it("upserts on user_id and returns ok:true on success", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const client = { from: vi.fn(() => ({ upsert })) } as unknown as SupabaseClient;

    const result = await setAiPreference(client, "user-1", { provider: "openai", modelTier: "capable" });
    expect(result.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", provider: "openai", model_tier: "capable" }),
      { onConflict: "user_id" },
    );
  });

  it("returns ok:false with the error message on a failed write", async () => {
    const upsert = vi.fn(async () => ({ error: { message: "write failed" } }));
    const client = { from: vi.fn(() => ({ upsert })) } as unknown as SupabaseClient;

    const result = await setAiPreference(client, "user-1", { provider: "deepseek", modelTier: "cheap" });
    expect(result).toEqual({ ok: false, error: "write failed" });
  });
});
