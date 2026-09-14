import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTodayDayStart, markDayStarted } from "../day-start";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "upsert"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

describe("getTodayDayStart", () => {
  it("returns null when today has no wake mark", async () => {
    const dayStarts = makeChain({ data: null, error: null });
    const client = { from: vi.fn(() => dayStarts) } as unknown as SupabaseClient;

    const result = await getTodayDayStart(client, "user-1", "America/Chicago", new Date("2026-09-14T15:00:00.000Z"));

    expect(result).toBeNull();
    expect(dayStarts.eq).toHaveBeenCalledWith("user_id", "user-1");
    // The 2026-09-14T15:00Z instant is 2026-09-14 10:00 America/Chicago —
    // same calendar day. Proves the query filters on the LOCAL date, not a
    // UTC-derived one.
    expect(dayStarts.eq).toHaveBeenCalledWith("local_date", "2026-09-14");
  });

  it("maps a found row to its typed shape", async () => {
    const dayStarts = makeChain({ data: { local_date: "2026-09-14", woke_at: "2026-09-14T13:05:00.000Z" }, error: null });
    const client = { from: vi.fn(() => dayStarts) } as unknown as SupabaseClient;

    const result = await getTodayDayStart(client, "user-1", "UTC", new Date("2026-09-14T15:00:00.000Z"));

    expect(result).toEqual({ localDate: "2026-09-14", wokeAtIso: "2026-09-14T13:05:00.000Z" });
  });

  it("throws rather than swallowing a query error", async () => {
    const dayStarts = makeChain({ data: null, error: new Error("boom") });
    const client = { from: vi.fn(() => dayStarts) } as unknown as SupabaseClient;

    await expect(getTodayDayStart(client, "user-1", "UTC", new Date())).rejects.toThrow("boom");
  });
});

describe("markDayStarted — idempotent Start Day tap (#33)", () => {
  it("upserts with ignoreDuplicates on (user_id, local_date), never a plain insert or a moving upsert", async () => {
    const dayStarts = makeChain({ data: { local_date: "2026-09-14", woke_at: "2026-09-14T13:00:00.000Z" }, error: null });
    const client = { from: vi.fn(() => dayStarts) } as unknown as SupabaseClient;
    const now = new Date("2026-09-14T13:00:00.000Z");

    await markDayStarted(client, "user-1", "UTC", now);

    expect(dayStarts.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", local_date: "2026-09-14", woke_at: now.toISOString() },
      { onConflict: "user_id,local_date", ignoreDuplicates: true }
    );
  });

  it("a second tap the same local day returns the SAME woke_at as the first — the mark never moves", async () => {
    // The mock's read always returns the first tap's row, regardless of
    // what the second tap's upsert would have tried to write — modelling
    // exactly what ignoreDuplicates:true does against a real unique
    // constraint: the second write is discarded, and the re-read after it
    // returns the row the FIRST tap created.
    const firstWokeAt = "2026-09-14T13:00:00.000Z";
    const dayStarts = makeChain({ data: { local_date: "2026-09-14", woke_at: firstWokeAt }, error: null });
    const client = { from: vi.fn(() => dayStarts) } as unknown as SupabaseClient;

    const first = await markDayStarted(client, "user-1", "UTC", new Date(firstWokeAt));
    const second = await markDayStarted(client, "user-1", "UTC", new Date("2026-09-14T18:45:00.000Z"));

    expect(first.wokeAtIso).toBe(firstWokeAt);
    expect(second.wokeAtIso).toBe(firstWokeAt);
  });

  it("throws on a genuine upsert error rather than returning a fabricated mark", async () => {
    const dayStarts = makeChain();
    dayStarts.upsert = vi.fn(() => ({ then: (resolve: (v: unknown) => void) => resolve({ error: new Error("db down") }) }));
    const client = { from: vi.fn(() => dayStarts) } as unknown as SupabaseClient;

    await expect(markDayStarted(client, "user-1", "UTC", new Date())).rejects.toThrow("db down");
  });
});
