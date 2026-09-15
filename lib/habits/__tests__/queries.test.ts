import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveHabitsWithStatus } from "../queries";

type Resp = { data: unknown; error: unknown };

function makeClient(responses: Record<string, Resp[]>) {
  const queues: Record<string, Resp[]> = Object.fromEntries(Object.entries(responses).map(([k, v]) => [k, [...v]]));
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "in"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (res: (v: Resp) => void) => res((queues[table] ?? []).shift() ?? { data: null, error: null });
    return chain;
  });
  return { from } as unknown as SupabaseClient;
}

const tz = "America/Chicago";

describe("getActiveHabitsWithStatus", () => {
  it("returns an empty list without querying votes when there are no active habits", async () => {
    const supabase = makeClient({ identity_habits: [{ data: [], error: null }] });
    const result = await getActiveHabitsWithStatus(supabase, "user-1", "2026-09-14", tz);
    expect(result).toEqual([]);
  });

  it("marks a habit under 7 local days old as New, with score = null", async () => {
    const supabase = makeClient({
      identity_habits: [
        { data: [{ id: "h1", identity_statement: "the athlete", rank: 1, created_at: "2026-09-10T12:00:00Z" }], error: null },
      ],
      habit_votes: [{ data: [], error: null }],
    });
    const [habit] = await getActiveHabitsWithStatus(supabase, "user-1", "2026-09-14", tz); // 4 days old
    expect(habit!.isNew).toBe(true);
    expect(habit!.score).toBeNull();
  });

  it("stops being New at exactly 7 local days old and gets a real replayed score", async () => {
    const supabase = makeClient({
      identity_habits: [
        { data: [{ id: "h1", identity_statement: "the athlete", rank: 1, created_at: "2026-09-07T12:00:00Z" }], error: null },
      ],
      habit_votes: [{ data: [{ habit_id: "h1", date: "2026-09-14" }], error: null }],
    });
    const [habit] = await getActiveHabitsWithStatus(supabase, "user-1", "2026-09-14", tz); // exactly 7 days old
    expect(habit!.isNew).toBe(false);
    expect(habit!.score).toBeCloseTo(0.04, 10); // one same-day vote, no prior history
  });

  it("reports votedToday true only when a vote row exists for exactly today's local date", async () => {
    const supabase = makeClient({
      identity_habits: [
        { data: [{ id: "h1", identity_statement: "the athlete", rank: 1, created_at: "2026-08-01T00:00:00Z" }], error: null },
      ],
      habit_votes: [
        {
          data: [
            { habit_id: "h1", date: "2026-09-13" },
            { habit_id: "h1", date: "2026-09-14" },
          ],
          error: null,
        },
      ],
    });
    const [habit] = await getActiveHabitsWithStatus(supabase, "user-1", "2026-09-14", tz);
    expect(habit!.votedToday).toBe(true);
  });

  it("keeps each habit's votes separate when multiple habits are returned", async () => {
    const supabase = makeClient({
      identity_habits: [
        {
          data: [
            { id: "h1", identity_statement: "the athlete", rank: 1, created_at: "2026-08-01T00:00:00Z" },
            { id: "h2", identity_statement: "the reader", rank: 2, created_at: "2026-08-01T00:00:00Z" },
          ],
          error: null,
        },
      ],
      habit_votes: [
        {
          data: [
            { habit_id: "h1", date: "2026-09-14" },
            { habit_id: "h2", date: "2026-09-01" },
          ],
          error: null,
        },
      ],
    });
    const [h1, h2] = await getActiveHabitsWithStatus(supabase, "user-1", "2026-09-14", tz);
    expect(h1!.votedToday).toBe(true);
    expect(h2!.votedToday).toBe(false);
    expect(h2!.score).toBeLessThan(h1!.score!);
  });

  it("orders habits by rank ascending (the query's own .order call, not a re-sort here)", async () => {
    const supabase = makeClient({
      identity_habits: [{ data: [], error: null }],
    });
    await getActiveHabitsWithStatus(supabase, "user-1", "2026-09-14", tz);
    expect((supabase.from as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value.order).toHaveBeenCalledWith("rank", {
      ascending: true,
    });
  });
});
