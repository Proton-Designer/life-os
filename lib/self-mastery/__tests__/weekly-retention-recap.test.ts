import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeLibraryRetentionSnapshot,
  computeTrend,
  dispatchUlmWeeklyRecaps,
  getUlmWeeklyRecap,
} from "../weekly-retention-recap";

type Call = { table: string; method: string; args: unknown[] };

/**
 * One fake table per call: `.from(table)` returns a chain that records every
 * `.eq`/`.in` call (so a test can assert the query is correctly scoped) and
 * resolves, when awaited, to `responses[table]` (or the next queued response
 * if an array was given, for tables hit more than once per invocation, e.g.
 * `profiles`/`ulm_weekly_recaps` across several users in the dispatch loop).
 */
function makeClient(responses: Record<string, { data: unknown; error: unknown } | { data: unknown; error: unknown }[]>) {
  const calls: Call[] = [];
  const cursors: Record<string, number> = {};
  const inserts: { table: string; payload: unknown }[] = [];

  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "returns"]) {
      chain[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      });
    }
    chain.maybeSingle = vi.fn(() => {
      const queued = responses[table];
      const resp = Array.isArray(queued) ? queued[(cursors[table] = (cursors[table] ?? -1) + 1)] : queued;
      const settled = resp ?? { data: null, error: null };
      // Real supabase-js's PostgrestFilterBuilder result still supports a
      // trailing `.returns<T>()` type-only cast after `.maybeSingle()` (see
      // sleep-intent-actions.ts's own identical chain) -- a thenable that is
      // ALSO chainable, not a bare Promise.
      return { returns: () => Promise.resolve(settled), then: (resolve: (v: unknown) => void) => resolve(settled) };
    });
    chain.insert = vi.fn((payload: unknown) => {
      inserts.push({ table, payload });
      const queued = responses[`${table}:insert`];
      const resp = Array.isArray(queued) ? queued[(cursors[`${table}:insert`] = (cursors[`${table}:insert`] ?? -1) + 1)] : queued;
      return Promise.resolve(resp ?? { data: null, error: null });
    });
    chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
      const queued = responses[table];
      const resp = Array.isArray(queued) ? queued[(cursors[table] = (cursors[table] ?? -1) + 1)] : queued;
      resolve(resp ?? { data: [], error: null });
    };
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, calls, inserts };
}

const NOW = new Date("2026-09-15T12:00:00Z");

describe("computeLibraryRetentionSnapshot", () => {
  it("an empty library: zero retention, no strongest/weakest", async () => {
    const { client } = makeClient({ books: { data: [], error: null } });
    const result = await computeLibraryRetentionSnapshot(client, "u1", NOW);
    expect(result).toEqual({ overallRetentionPct: 0, strongestBook: null, weakestBook: null });
  });

  it("scopes every table by user_id", async () => {
    const { client, calls } = makeClient({ books: { data: [], error: null } });
    await computeLibraryRetentionSnapshot(client, "u1", NOW);
    expect(calls.some((c) => c.table === "books" && c.method === "eq" && c.args[0] === "user_id" && c.args[1] === "u1")).toBe(true);
  });

  it("a book with only NEW (never-reviewed) cards is NOT a strongest/weakest candidate -- unstarted is a status, not an insight", async () => {
    const { client } = makeClient({
      books: { data: [{ id: "b1", title: "Untouched Book" }], error: null },
      cards: { data: [{ id: "c1", book_id: "b1" }], error: null },
      card_states: { data: [], error: null }, // no card_states row at all -- never reviewed
    });
    const result = await computeLibraryRetentionSnapshot(client, "u1", NOW);
    expect(result.strongestBook).toBeNull();
    expect(result.weakestBook).toBeNull();
    expect(result.overallRetentionPct).toBe(0); // untouched counts as zero, not excluded
  });

  it("picks the highest and lowest retrievability books as strongest/weakest among REVIEWED-card books", async () => {
    const { client } = makeClient({
      books: {
        data: [
          { id: "b1", title: "Strong Book" },
          { id: "b2", title: "Weak Book" },
        ],
        error: null,
      },
      cards: {
        data: [
          { id: "c1", book_id: "b1" },
          { id: "c2", book_id: "b2" },
        ],
        error: null,
      },
      card_states: {
        data: [
          // A fresh review (last_review_at = now) reads near-perfect retrievability.
          { card_id: "c1", state: "review", stability: 100, difficulty: 5, due_at: null, reps: 5, lapses: 0, last_review_at: NOW.toISOString(), learning_steps: 0 },
          // A long-overdue, low-stability review reads much weaker.
          { card_id: "c2", state: "review", stability: 1, difficulty: 8, due_at: null, reps: 1, lapses: 3, last_review_at: "2026-01-01T00:00:00Z", learning_steps: 0 },
        ],
        error: null,
      },
    });
    const result = await computeLibraryRetentionSnapshot(client, "u1", NOW);
    expect(result.strongestBook?.title).toBe("Strong Book");
    expect(result.weakestBook?.title).toBe("Weak Book");
    expect(result.strongestBook!.retentionPct).toBeGreaterThan(result.weakestBook!.retentionPct);
  });

  it("a library with exactly one reviewed book: it is both strongest AND weakest -- a real, non-error state", async () => {
    const { client } = makeClient({
      books: { data: [{ id: "b1", title: "Only Book" }], error: null },
      cards: { data: [{ id: "c1", book_id: "b1" }], error: null },
      card_states: {
        data: [{ card_id: "c1", state: "review", stability: 50, difficulty: 5, due_at: null, reps: 3, lapses: 0, last_review_at: NOW.toISOString(), learning_steps: 0 }],
        error: null,
      },
    });
    const result = await computeLibraryRetentionSnapshot(client, "u1", NOW);
    expect(result.strongestBook?.id).toBe("b1");
    expect(result.weakestBook?.id).toBe("b1");
  });
});

describe("computeTrend", () => {
  it("no previous week's data -- 'no_data', not a fabricated flat/up/down", () => {
    expect(computeTrend(80, null)).toBe("no_data");
  });

  it("a rise past the epsilon is 'up'", () => {
    expect(computeTrend(80, 70)).toBe("up");
  });

  it("a drop past the epsilon is 'down'", () => {
    expect(computeTrend(70, 80)).toBe("down");
  });

  it("sub-epsilon drift in either direction is 'flat', not noise reported as a trend", () => {
    expect(computeTrend(80.5, 80)).toBe("flat");
    expect(computeTrend(79.5, 80)).toBe("flat");
  });

  it("exactly at the epsilon boundary is still flat (strict >)", () => {
    expect(computeTrend(81, 80)).toBe("flat");
  });
});

describe("dispatchUlmWeeklyRecaps", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("skips a user for whom today is not their own local week-start day", async () => {
    // NOW is 2026-09-15, a Tuesday -- not a Sunday in any real timezone offset used here.
    const { client, inserts } = makeClient({
      profiles: { data: [{ user_id: "u1", timezone: "UTC" }], error: null },
    });
    const result = await dispatchUlmWeeklyRecaps(client, NOW);
    expect(result).toEqual({ usersChecked: 1, recorded: 0 });
    expect(inserts).toHaveLength(0);
  });

  it("skips a user whose local Sunday is outside the [04:00,09:00) generation window", async () => {
    const sunday830pm = new Date("2026-09-13T20:30:00Z"); // Sunday, well past the window in UTC
    const { client, inserts } = makeClient({
      profiles: { data: [{ user_id: "u1", timezone: "UTC" }], error: null },
    });
    const result = await dispatchUlmWeeklyRecaps(client, sunday830pm);
    expect(result).toEqual({ usersChecked: 1, recorded: 0 });
    expect(inserts).toHaveLength(0);
  });

  it("records a recap for a user whose local Sunday morning falls inside the window", async () => {
    const sundayMorning = new Date("2026-09-13T06:00:00Z"); // Sunday 06:00 UTC
    const { client, inserts } = makeClient({
      profiles: { data: [{ user_id: "u1", timezone: "UTC" }], error: null },
      books: { data: [], error: null },
      ulm_weekly_recaps: { data: null, error: null }, // no previous week's row
      "ulm_weekly_recaps:insert": { data: null, error: null },
    });
    const result = await dispatchUlmWeeklyRecaps(client, sundayMorning);
    expect(result).toEqual({ usersChecked: 1, recorded: 1 });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.payload).toMatchObject({ user_id: "u1", trend: "no_data" });
  });

  it("treats a unique-constraint violation on insert as 'already recorded this week', not a failure", async () => {
    const sundayMorning = new Date("2026-09-13T06:00:00Z");
    const { client, inserts } = makeClient({
      profiles: { data: [{ user_id: "u1", timezone: "UTC" }], error: null },
      books: { data: [], error: null },
      ulm_weekly_recaps: { data: null, error: null },
      "ulm_weekly_recaps:insert": { data: null, error: { code: "23505", message: "duplicate key" } },
    });
    const result = await dispatchUlmWeeklyRecaps(client, sundayMorning);
    expect(result).toEqual({ usersChecked: 1, recorded: 0 });
    expect(inserts).toHaveLength(1);
  });

  it("one user's thrown error does not abort the batch for other users", async () => {
    const sundayMorning = new Date("2026-09-13T06:00:00Z");
    const { client } = makeClient({
      profiles: {
        data: [
          { user_id: "u-broken", timezone: "UTC" },
          { user_id: "u-fine", timezone: "UTC" },
        ],
        error: null,
      },
      books: [
        { data: null, error: { message: "connection reset" } }, // u-broken's books query throws
        { data: [], error: null }, // u-fine's books query succeeds
      ],
      ulm_weekly_recaps: { data: null, error: null },
      "ulm_weekly_recaps:insert": { data: null, error: null },
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await dispatchUlmWeeklyRecaps(client, sundayMorning);
    expect(result).toEqual({ usersChecked: 2, recorded: 1 });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("u-broken"), expect.anything());
  });
});

describe("getUlmWeeklyRecap", () => {
  it("returns null when nothing was generated for that week", async () => {
    const { client } = makeClient({ ulm_weekly_recaps: { data: null, error: null } });
    const result = await getUlmWeeklyRecap(client, "u1", "2026-09-07");
    expect(result).toBeNull();
  });

  it("returns null on a read error, never throws for a display-only reader", async () => {
    const { client } = makeClient({ ulm_weekly_recaps: { data: null, error: { message: "boom" } } });
    const result = await getUlmWeeklyRecap(client, "u1", "2026-09-07");
    expect(result).toBeNull();
  });

  it("maps a real row, including null book titles when a book was later deleted (SET NULL)", async () => {
    const { client } = makeClient({
      ulm_weekly_recaps: {
        data: { week_start: "2026-09-07", overall_retention_pct: "82.50", trend: "up", strongest_book_title: null, weakest_book_title: "Deep Work" },
        error: null,
      },
    });
    const result = await getUlmWeeklyRecap(client, "u1", "2026-09-07");
    expect(result).toEqual({
      weekStart: "2026-09-07",
      overallRetentionPct: 82.5,
      trend: "up",
      strongestBook: null,
      weakestBook: { title: "Deep Work" },
    });
  });
});
