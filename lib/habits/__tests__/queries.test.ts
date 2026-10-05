import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveHabitsWithStatus, getPausedHabits } from "../queries";
import { HABIT_VOTE_WEIGHT, HABIT_DECAY_FACTOR } from "../decay-score";

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

  it("voteCount (P2-11) is the habit's own total vote-row count, not the global total across habits", async () => {
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
            { habit_id: "h1", date: "2026-09-12" },
            { habit_id: "h1", date: "2026-09-13" },
            { habit_id: "h1", date: "2026-09-14" },
            { habit_id: "h2", date: "2026-09-14" },
          ],
          error: null,
        },
      ],
    });
    const [h1, h2] = await getActiveHabitsWithStatus(supabase, "user-1", "2026-09-14", tz);
    expect(h1!.voteCount).toBe(3);
    expect(h2!.voteCount).toBe(1);
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

  // P3-07: pause windows feed decay-score.ts's own freeze math -- this is
  // just the plumbing (fetch + pass-through), the math itself is
  // decay-score.test.ts's job.
  it("fetches and applies this habit's pause windows to its score (P3-07)", async () => {
    const supabase = makeClient({
      identity_habits: [
        { data: [{ id: "h1", identity_statement: "the athlete", rank: 1, created_at: "2026-08-01T00:00:00Z" }], error: null },
      ],
      habit_votes: [{ data: [{ habit_id: "h1", date: "2026-08-01" }], error: null }],
      identity_habit_pauses: [
        { data: [{ habit_id: "h1", paused_at: "2026-08-01", resumed_at: "2026-09-14" }], error: null },
      ],
    });
    const [habit] = await getActiveHabitsWithStatus(supabase, "user-1", "2026-09-14", tz);
    // Fully paused from the vote date through today -- score reads as if
    // the vote were cast today (0 effective days elapsed).
    expect(habit!.score).toBeCloseTo(HABIT_VOTE_WEIGHT, 10);
  });

  it("a habit with no pause rows at all scores identically to before P3-07 (empty pauseRanges is a true no-op)", async () => {
    const supabase = makeClient({
      identity_habits: [
        { data: [{ id: "h1", identity_statement: "the athlete", rank: 1, created_at: "2026-08-01T00:00:00Z" }], error: null },
      ],
      habit_votes: [{ data: [{ habit_id: "h1", date: "2026-08-01" }], error: null }],
    });
    const [habit] = await getActiveHabitsWithStatus(supabase, "user-1", "2026-08-31", tz);
    expect(habit!.score).toBeCloseTo(HABIT_VOTE_WEIGHT * Math.pow(HABIT_DECAY_FACTOR, 30), 10);
  });
});

describe("getPausedHabits (P3-07)", () => {
  it("returns this user's paused habits, ordered by rank", async () => {
    const supabase = makeClient({
      identity_habits: [
        {
          data: [
            { id: "h1", identity_statement: "the athlete", rank: 3 },
            { id: "h2", identity_statement: "the reader", rank: 1 },
          ],
          error: null,
        },
      ],
    });
    const result = await getPausedHabits(supabase, "user-1");
    expect(result).toEqual([
      { id: "h1", identityStatement: "the athlete", rank: 3 },
      { id: "h2", identityStatement: "the reader", rank: 1 },
    ]);
  });

  it("scopes the read to status = 'paused'", async () => {
    const supabase = makeClient({ identity_habits: [{ data: [], error: null }] });
    await getPausedHabits(supabase, "user-1");
    const chain = (supabase.from as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    expect(chain.eq).toHaveBeenCalledWith("status", "paused");
  });
});

describe("getActiveHabitsWithStatus — cadence (HABIT-FREQ)", () => {
  // today 2026-10-07 is a Wednesday; the Sun-Sat week is 10-04..10-10
  const row = (over: Record<string, unknown>) => ({ id: "h1", identity_statement: "the athlete", rank: 1, created_at: "2026-06-01T00:00:00Z", ...over });

  it("a habit with no cadence columns is daily and due (every pre-existing row)", async () => {
    const supabase = makeClient({ identity_habits: [{ data: [row({})], error: null }], habit_votes: [{ data: [], error: null }] });
    const [h] = await getActiveHabitsWithStatus(supabase, "user-1", "2026-10-07", tz);
    expect(h!.frequency).toEqual({ kind: "daily" });
    expect(h!.due.due).toBe(true);
    expect(h!.streak.unit).toBe("day");
  });

  it("'3× a week': this week's votes drive progress and due-ness, and the score decays per expected gap", async () => {
    const votesFor = (dates: string[]) => dates.map((date) => ({ habit_id: "h1", date }));
    const base = { frequency_type: "per_week", frequency_count: 3 };
    const mid = makeClient({ identity_habits: [{ data: [row(base)], error: null }], habit_votes: [{ data: votesFor(["2026-10-03", "2026-10-05"]), error: null }] });
    const [h] = await getActiveHabitsWithStatus(mid, "user-1", "2026-10-07", tz);
    expect(h!.due.progress).toEqual({ done: 1, target: 3, unit: "week" }); // 10-03 was last week
    expect(h!.due.due).toBe(true);

    const met = makeClient({ identity_habits: [{ data: [row(base)], error: null }], habit_votes: [{ data: votesFor(["2026-10-04", "2026-10-05", "2026-10-06"]), error: null }] });
    const [m] = await getActiveHabitsWithStatus(met, "user-1", "2026-10-07", tz);
    expect(m!.due.due).toBe(false);
    expect(m!.streak).toEqual({ count: 1, unit: "week" });

    // the score uses the per-gap rate: the same single vote 2 days ago decays LESS for a 3x/week habit than for a daily one
    const one = [{ habit_id: "h1", date: "2026-10-05" }];
    const daily = makeClient({ identity_habits: [{ data: [row({})], error: null }], habit_votes: [{ data: one, error: null }] });
    const weekly = makeClient({ identity_habits: [{ data: [row(base)], error: null }], habit_votes: [{ data: one, error: null }] });
    const [d] = await getActiveHabitsWithStatus(daily, "user-1", "2026-10-07", tz);
    const [w] = await getActiveHabitsWithStatus(weekly, "user-1", "2026-10-07", tz);
    expect(w!.score!).toBeGreaterThan(d!.score!);
    expect(d!.score!).toBeCloseTo(HABIT_VOTE_WEIGHT * HABIT_DECAY_FACTOR ** 2, 10);
    expect(w!.score!).toBeCloseTo(HABIT_VOTE_WEIGHT * HABIT_DECAY_FACTOR ** (2 * (3 / 7)), 10);
  });

  it("'Mon · Wed · Fri' is not due on a Tuesday", async () => {
    const supabase = makeClient({
      identity_habits: [{ data: [row({ frequency_type: "weekdays", frequency_days: [1, 3, 5] })], error: null }],
      habit_votes: [{ data: [], error: null }],
    });
    const [h] = await getActiveHabitsWithStatus(supabase, "user-1", "2026-10-06", tz);
    expect(h!.due.due).toBe(false);
    expect(h!.due.statusText).toBe("Next: Wed");
  });
});
