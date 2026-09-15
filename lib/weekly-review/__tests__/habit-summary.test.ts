import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getHabitWeeklySummaries } from "../habit-summary";

type Resp = { data: unknown; error: unknown };

function makeClient(responses: Record<string, Resp>) {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "in"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (res: (v: Resp) => void) => res(responses[table] ?? { data: [], error: null });
    return chain;
  });
  return { from } as unknown as SupabaseClient;
}

const tz = "America/Chicago";
const weekStart = "2026-09-06";
const weekEnd = "2026-09-13"; // exclusive
const today = "2026-09-14";

describe("getHabitWeeklySummaries", () => {
  it("counts only the votes that fall inside the reviewed week's range", async () => {
    const supabase = makeClient({
      identity_habits: {
        data: [{ id: "h1", identity_statement: "the athlete", rank: 1, created_at: "2026-01-01T00:00:00Z" }],
        error: null,
      },
      habit_votes: {
        data: [
          { habit_id: "h1", date: "2026-09-06" }, // in range
          { habit_id: "h1", date: "2026-09-10" }, // in range
          { habit_id: "h1", date: "2026-09-13" }, // NOT in range (endExclusive)
          { habit_id: "h1", date: "2026-09-14" }, // NOT in range (this week, today)
          { habit_id: "h1", date: "2026-08-01" }, // NOT in range (long before)
        ],
        error: null,
      },
    });
    const [summary] = await getHabitWeeklySummaries(supabase, "user-1", weekStart, weekEnd, today, tz);
    expect(summary!.votesThisWeek).toBe(2);
  });

  it("scores as of `today`, not as of the reviewed week's end, even for a past week", async () => {
    const supabase = makeClient({
      identity_habits: {
        data: [{ id: "h1", identity_statement: "the athlete", rank: 1, created_at: "2026-01-01T00:00:00Z" }],
        error: null,
      },
      habit_votes: { data: [{ habit_id: "h1", date: today }], error: null }, // voted today, well after the reviewed week
    });
    const [summary] = await getHabitWeeklySummaries(supabase, "user-1", weekStart, weekEnd, today, tz);
    expect(summary!.score).toBeCloseTo(0.04, 10); // one same-day (as of `today`) vote
    expect(summary!.votesThisWeek).toBe(0); // that vote isn't inside the reviewed week at all
  });

  it("marks a habit under 7 local days old as New, with score null, same rule as the /habits page", async () => {
    const supabase = makeClient({
      identity_habits: {
        data: [{ id: "h1", identity_statement: "the athlete", rank: 1, created_at: "2026-09-12T00:00:00Z" }], // 2 days old as of `today`
        error: null,
      },
      habit_votes: { data: [], error: null },
    });
    const [summary] = await getHabitWeeklySummaries(supabase, "user-1", weekStart, weekEnd, today, tz);
    expect(summary!.isNew).toBe(true);
    expect(summary!.score).toBeNull();
  });

  it("returns an empty array when there are no active habits", async () => {
    const supabase = makeClient({ identity_habits: { data: [], error: null } });
    const result = await getHabitWeeklySummaries(supabase, "user-1", weekStart, weekEnd, today, tz);
    expect(result).toEqual([]);
  });
});
