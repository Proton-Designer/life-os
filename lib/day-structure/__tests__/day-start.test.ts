import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTodayDayStart, markDayStarted, getDayStartsForRange, resolveWakeInstant } from "../day-start";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "upsert", "gte", "lt"]) {
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

describe("getDayStartsForRange — P3-09's per-day wake marks for a review week", () => {
  it("returns a Map keyed by local_date, scoped to the given range", async () => {
    const dayStarts = makeChain({
      data: [
        { local_date: "2026-09-08", woke_at: "2026-09-08T13:00:00.000Z" },
        { local_date: "2026-09-10", woke_at: "2026-09-10T12:30:00.000Z" },
      ],
      error: null,
    });
    const client = { from: vi.fn(() => dayStarts) } as unknown as SupabaseClient;

    const result = await getDayStartsForRange(client, "user-1", "2026-09-08", "2026-09-15");

    expect(dayStarts.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(dayStarts.gte).toHaveBeenCalledWith("local_date", "2026-09-08");
    expect(dayStarts.lt).toHaveBeenCalledWith("local_date", "2026-09-15");
    expect(result).toEqual(
      new Map([
        ["2026-09-08", "2026-09-08T13:00:00.000Z"],
        ["2026-09-10", "2026-09-10T12:30:00.000Z"],
      ])
    );
  });

  it("returns an empty Map, never null/undefined, when no day in range has a wake mark", async () => {
    const dayStarts = makeChain({ data: [], error: null });
    const client = { from: vi.fn(() => dayStarts) } as unknown as SupabaseClient;

    const result = await getDayStartsForRange(client, "user-1", "2026-09-08", "2026-09-15");

    expect(result.size).toBe(0);
  });

  it("throws rather than swallowing a query error", async () => {
    const dayStarts = makeChain({ data: null, error: new Error("boom") });
    const client = { from: vi.fn(() => dayStarts) } as unknown as SupabaseClient;

    await expect(getDayStartsForRange(client, "user-1", "2026-09-08", "2026-09-15")).rejects.toThrow("boom");
  });
});

describe("markDayStarted — an earlier wake time (recovery)", () => {
  it("records the chosen wake instant instead of now, still insert-only (ignoreDuplicates): an existing mark is never moved", async () => {
    const dayStarts = makeChain({ data: { local_date: "2026-09-14", woke_at: "2026-09-14T12:00:00.000Z" }, error: null });
    const client = { from: vi.fn(() => dayStarts) } as unknown as SupabaseClient;
    const now = new Date("2026-09-14T14:00:00.000Z");
    const wokeAt = new Date("2026-09-14T12:00:00.000Z");
    await markDayStarted(client, "user-1", "UTC", now, wokeAt);
    expect(dayStarts.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", local_date: "2026-09-14", woke_at: wokeAt.toISOString() },
      { onConflict: "user_id,local_date", ignoreDuplicates: true }
    );
  });
});

describe("resolveWakeInstant", () => {
  const CHI = "America/Chicago";
  const now = new Date("2026-10-05T14:30:00.000Z"); // 9:30 AM Chicago, Mon Oct 5

  it("turns a local time of day into the instant on the user's local TODAY", () => {
    const r = resolveWakeInstant("07:00", CHI, now);
    expect(r).toEqual({ ok: true, at: new Date("2026-10-05T12:00:00.000Z") }); // 7:00 AM CDT
  });

  it("uses the user's own local date, not UTC's: at 8 PM Chicago (already Oct 6 in UTC) 'today' is still Oct 5", () => {
    const evening = new Date("2026-10-06T01:00:00.000Z"); // 8:00 PM CDT Oct 5
    const r = resolveWakeInstant("07:00", CHI, evening);
    expect(r).toEqual({ ok: true, at: new Date("2026-10-05T12:00:00.000Z") });
  });

  it("accepts exactly now, refuses a time that hasn't happened yet today", () => {
    expect(resolveWakeInstant("09:30", CHI, now).ok).toBe(true);
    const future = resolveWakeInstant("09:31", CHI, now);
    expect(future).toEqual({ ok: false, message: "That time hasn't happened yet today." });
  });

  it("refuses malformed values, never a NaN date", () => {
    for (const bad of ["", "7am", "25:00", "07:60", "7:00", "07:00:00", "noon"]) {
      expect(resolveWakeInstant(bad, CHI, now), bad).toEqual({ ok: false, message: "Enter a valid wake time." });
    }
  });
});

