import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markPrayerCore, toggleSunnahCore, toggleAdhkarCore, fetchTimezone } from "../actions-core";

function makeClient(opts: { existing?: { completed: boolean } | null; upsertError?: unknown; id?: string } = {}) {
  const upsertCalls: Record<string, unknown>[] = [];
  const from = vi.fn((_table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) chain[m] = vi.fn(() => chain);
    // The pre-upsert "does a row already exist" lookup (toggle* functions only).
    chain.maybeSingle = vi.fn(async () => ({ data: opts.existing ?? null, error: null }));
    chain.upsert = vi.fn((row: Record<string, unknown>) => {
      upsertCalls.push(row);
      return chain; // chainable -- every core function does .upsert(...).select("id"[, ...]).single()
    });
    // The post-upsert "select the row back" call every core function makes.
    chain.single = vi.fn(async () => ({
      data: opts.upsertError ? null : { id: opts.id ?? "row-1", logged_at: (upsertCalls[upsertCalls.length - 1]?.logged_at as string) ?? null },
      error: opts.upsertError ?? null,
    }));
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, upsertCalls };
}

describe("markPrayerCore — AGENTS.md's timezone rule, pinned at the exact UTC-rollover boundary", () => {
  it("18:59 local (Chicago, UTC-5) in the same instant as 23:59 UTC: marking 'today' in Chicago succeeds", async () => {
    // 23:59 UTC == 18:59 America/Chicago (UTC-5 in September) -- same calendar day both sides.
    const now = new Date("2026-09-08T23:59:00.000Z");
    const { client, upsertCalls } = makeClient();

    await markPrayerCore(client, "user-1", "America/Chicago", now, "2026-09-08", "isha", "on_time");

    expect(upsertCalls[0]).toMatchObject({ date: "2026-09-08", prayer_name: "isha", status: "on_time" });
  });

  it("19:01 local (Chicago) — one minute later, but still 2026-09-08 in Chicago even though UTC has rolled to the 9th: the SAME date must still be accepted as 'today', not rejected as a future date", async () => {
    // 00:01 UTC next day == 19:01 America/Chicago the PREVIOUS day.
    const now = new Date("2026-09-09T00:01:00.000Z");
    const { client, upsertCalls } = makeClient();

    // If this were computed from UTC instead of Chicago's local date, "today"
    // would read as 2026-09-09 and marking 2026-09-08 would look like the
    // PAST (still fine), but marking 2026-09-09 itself would look like a
    // FUTURE date relative to a Chicago-local "today" of 09-08 — exactly
    // AGENTS.md's "activity blocks collapse to zero width" failure mode,
    // just on the write side instead of the read side.
    await markPrayerCore(client, "user-1", "America/Chicago", now, "2026-09-08", "fajr", "on_time");
    expect(upsertCalls[0]).toMatchObject({ date: "2026-09-08" });
  });

  it("a timezone EAST of UTC inverts the boundary, proving this isn't hardcoded toward 'behind UTC'", async () => {
    // 23:30 UTC is already 2026-09-09 08:30 in Asia/Tokyo (UTC+9, no DST).
    const now = new Date("2026-09-08T23:30:00.000Z");
    const { client, upsertCalls } = makeClient();

    // "Today" in Tokyo at this instant is the 9th -- marking the 9th must
    // succeed, and marking a date after the 9th must still be rejected.
    await markPrayerCore(client, "user-1", "Asia/Tokyo", now, "2026-09-09", "fajr", "on_time");
    expect(upsertCalls[0]).toMatchObject({ date: "2026-09-09" });

    await expect(markPrayerCore(client, "user-1", "Asia/Tokyo", now, "2026-09-10", "fajr", "on_time")).rejects.toThrow(/after today/i);
  });

  it("rejects a date strictly after today, in the GIVEN timezone", async () => {
    const now = new Date("2026-09-08T12:00:00.000Z"); // unambiguously 09-08 everywhere relevant
    const { client, upsertCalls } = makeClient();

    await expect(markPrayerCore(client, "user-1", "America/Chicago", now, "2026-09-09", "fajr", "on_time")).rejects.toThrow(/after today/i);
    expect(upsertCalls).toHaveLength(0);
  });

  it("allows today itself — the guard is strictly-after, not on-or-after", async () => {
    const now = new Date("2026-09-08T12:00:00.000Z");
    const { client, upsertCalls } = makeClient();

    await markPrayerCore(client, "user-1", "America/Chicago", now, "2026-09-08", "fajr", "on_time");
    expect(upsertCalls).toHaveLength(1);
  });

  it("sets logged_at to the given `now`, not a fresh Date() call — deterministic, not ambient", async () => {
    const now = new Date("2026-09-08T12:00:00.000Z");
    const { client, upsertCalls } = makeClient();

    await markPrayerCore(client, "user-1", "UTC", now, "2026-09-08", "fajr", "on_time");
    expect(upsertCalls[0]).toMatchObject({ logged_at: now.toISOString() });
  });

  it("surfaces a DB error as a real throw", async () => {
    const { client } = makeClient({ upsertError: { message: "boom" } });
    await expect(
      markPrayerCore(client, "user-1", "UTC", new Date("2026-09-08T12:00:00Z"), "2026-09-08", "fajr", "on_time"),
    ).rejects.toThrow(/boom/);
  });
});

describe("toggleSunnahCore", () => {
  it("pins the same UTC-rollover boundary as markPrayerCore (America/Chicago, 19:01 local)", async () => {
    const now = new Date("2026-09-09T00:01:00.000Z"); // 19:01 Chicago on the 8th
    const { client, upsertCalls } = makeClient({ existing: { completed: false } });

    await toggleSunnahCore(client, "user-1", "America/Chicago", now, "2026-09-08", "fajr", "before");
    expect(upsertCalls[0]).toMatchObject({ date: "2026-09-08", completed: true });
  });

  it("rejects a date after today", async () => {
    const now = new Date("2026-09-08T12:00:00.000Z");
    const { client, upsertCalls } = makeClient();
    await expect(toggleSunnahCore(client, "user-1", "America/Chicago", now, "2099-01-01", "fajr", "before")).rejects.toThrow(/after today/i);
    expect(upsertCalls).toHaveLength(0);
  });

  it("flips completed false -> true", async () => {
    const { client, upsertCalls } = makeClient({ existing: { completed: false } });
    const result = await toggleSunnahCore(client, "user-1", "UTC", new Date("2026-09-08T12:00:00Z"), "2026-09-08", "dhuhr", "after");
    expect(upsertCalls[0]).toMatchObject({ completed: true });
    expect(result.completed).toBe(true);
  });

  it("flips completed true -> false", async () => {
    const { client, upsertCalls } = makeClient({ existing: { completed: true } });
    await toggleSunnahCore(client, "user-1", "UTC", new Date("2026-09-08T12:00:00Z"), "2026-09-08", "dhuhr", "after");
    expect(upsertCalls[0]).toMatchObject({ completed: false });
  });

  it("treats no existing row as completed:false, so the first toggle sets it true", async () => {
    const { client, upsertCalls } = makeClient({ existing: null });
    await toggleSunnahCore(client, "user-1", "UTC", new Date("2026-09-08T12:00:00Z"), "2026-09-08", "isha", "witr");
    expect(upsertCalls[0]).toMatchObject({ completed: true });
  });
});

describe("toggleAdhkarCore", () => {
  it("has NO future-date guard, matching the original toggleAdhkar's behavior exactly", async () => {
    const { client, upsertCalls } = makeClient({ existing: { completed: false } });
    await expect(toggleAdhkarCore(client, "user-1", "2099-01-01", "morning")).resolves.not.toThrow();
    expect(upsertCalls[0]).toMatchObject({ date: "2099-01-01", completed: true });
  });

  it("flips completed false -> true", async () => {
    const { client, upsertCalls } = makeClient({ existing: { completed: false } });
    await toggleAdhkarCore(client, "user-1", "2026-09-08", "evening");
    expect(upsertCalls[0]).toMatchObject({ completed: true, period: "evening" });
  });

  it("flips completed true -> false", async () => {
    const { client, upsertCalls } = makeClient({ existing: { completed: true } });
    await toggleAdhkarCore(client, "user-1", "2026-09-08", "evening");
    expect(upsertCalls[0]).toMatchObject({ completed: false });
  });
});

describe("fetchTimezone", () => {
  it("returns the stored timezone", async () => {
    const from = vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({ data: { timezone: "America/Chicago" }, error: null }));
      return chain;
    });
    const result = await fetchTimezone({ from } as unknown as SupabaseClient, "user-1");
    expect(result).toBe("America/Chicago");
  });

  it("defaults to UTC when there's no profile row yet", async () => {
    const from = vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      return chain;
    });
    const result = await fetchTimezone({ from } as unknown as SupabaseClient, "user-1");
    expect(result).toBe("UTC");
  });
});
