import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createIdentityHabitCore,
  archiveIdentityHabitCore,
  killIdentityHabitCore,
  castHabitVoteCore,
  retractHabitVoteCore,
  pauseIdentityHabitCore,
  resumeIdentityHabitCore,
  MAX_ACTIVE_HABITS,
} from "../actions-core";

type Resp = { data: unknown; error: unknown; count?: number | null };
type Call = { method: string; args: unknown[] };

/**
 * Per-table fake client: each `.from(table)` call pops the next queued
 * response for that table and hands it back from `.then()`/`.single()`/
 * `.maybeSingle()` alike -- same "per-table sequential queue" shape as
 * lib/distractions/__tests__/actions-core.test.ts's own `makeClient`,
 * simplified since none of these functions branch on `.single()` vs. a
 * bare array the way captureCore's conflict-lookup does.
 */
function makeClient(responses: Record<string, Resp[]>) {
  const calls: Record<string, Call[]> = {};
  const queues: Record<string, Resp[]> = Object.fromEntries(Object.entries(responses).map(([k, v]) => [k, [...v]]));

  const from = vi.fn((table: string) => {
    calls[table] ??= [];
    const chain: Record<string, unknown> = {};
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls[table]!.push({ method, args });
        return chain;
      };
    for (const method of ["select", "eq", "insert", "update", "delete", "upsert", "order", "in", "is"]) {
      chain[method] = vi.fn(record(method));
    }
    const resolve = (): Resp => (queues[table] ?? []).shift() ?? { data: null, error: null };
    chain.single = vi.fn(async () => resolve());
    chain.maybeSingle = vi.fn(async () => resolve());
    chain.then = (res: (v: Resp) => void) => res(resolve());
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, calls };
}

const now = new Date("2026-09-14T20:00:00.000Z"); // 15:00 CDT
const tz = "America/Chicago";
const today = "2026-09-14";
const yesterday = "2026-09-13";

describe("createIdentityHabitCore", () => {
  it("assigns the lowest free rank when some are taken", async () => {
    const { client, calls } = makeClient({
      identity_habits: [
        { data: [{ rank: 1 }, { rank: 3 }], error: null }, // active ranks
        { data: { id: "h1", identity_statement: "the athlete", rank: 2, created_at: "2026-09-14T00:00:00Z" }, error: null }, // insert result
      ],
    });

    const habit = await createIdentityHabitCore(client, "user-1", "the athlete");

    expect(habit).toEqual({ id: "h1", identityStatement: "the athlete", rank: 2, createdAt: "2026-09-14T00:00:00Z" });
    const inserts = calls.identity_habits!.filter((c) => c.method === "insert");
    expect(inserts[0]!.args[0]).toMatchObject({ user_id: "user-1", identity_statement: "the athlete", rank: 2 });
  });

  it("assigns rank 1 for the very first habit", async () => {
    const { client } = makeClient({
      identity_habits: [
        { data: [], error: null },
        { data: { id: "h1", identity_statement: "the reader", rank: 1, created_at: "2026-09-14T00:00:00Z" }, error: null },
      ],
    });
    const habit = await createIdentityHabitCore(client, "user-1", "the reader");
    expect(habit.rank).toBe(1);
  });

  it("rejects a blank identity statement without querying the database", async () => {
    const { client } = makeClient({});
    await expect(createIdentityHabitCore(client, "user-1", "   ")).rejects.toThrow(/needs a statement/);
    expect((client.from as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it(`refuses a ${MAX_ACTIVE_HABITS + 1}th active habit before ever attempting the insert`, async () => {
    const fullRanks = Array.from({ length: MAX_ACTIVE_HABITS }, (_, i) => ({ rank: i + 1 }));
    const { client, calls } = makeClient({
      identity_habits: [{ data: fullRanks, error: null }],
    });
    await expect(createIdentityHabitCore(client, "user-1", "the athlete")).rejects.toThrow(/already have 7/);
    expect(calls.identity_habits!.some((c) => c.method === "insert")).toBe(false);
  });

  it("propagates a real database error (e.g. a genuine cross-tab rank race) rather than swallowing it", async () => {
    const { client } = makeClient({
      identity_habits: [{ data: [], error: null }, { data: null, error: { code: "23505", message: "duplicate key" } }],
    });
    await expect(createIdentityHabitCore(client, "user-1", "the athlete")).rejects.toMatchObject({ code: "23505" });
  });

  /**
   * P3-07 BLOCKING FINDING (Sonnet ENG 1's own P3-07 review, fixed here per
   * Opus Lead's direct 13:54 assignment): migration 202 widened
   * `identity_habits_rank_per_user_idx` to `where status in ('active',
   * 'paused')` -- a paused habit keeps its rank slot (its own header:
   * "pausing does not mean 'not one of my chosen identities anymore'").
   * The pre-check here must therefore see paused ranks too, or it computes
   * a "free" rank that the DB's own unique index then refuses with a raw
   * 23505 instead of the friendly ceiling message.
   *
   * This fake client actually distinguishes `.eq("status","active")` from
   * `.in("status", [...])` (unlike the shared per-table queue `makeClient`
   * above, which is blind to filter args) -- it has to, precisely because
   * the bug and the fix differ ONLY in which statuses the query asks for.
   */
  function makeStatusAwareRankClient(rows: { rank: number; status: "active" | "paused" }[]) {
    const calls: Call[] = [];
    let insertPayload: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {};
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ method, args });
        return chain;
      };
    chain.select = vi.fn(record("select"));
    chain.eq = vi.fn(record("eq"));
    chain.in = vi.fn(record("in"));
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      insertPayload = row;
      calls.push({ method: "insert", args: [row] });
      return chain;
    });
    chain.single = vi.fn(async () => ({
      data: { id: "h1", identity_statement: String(insertPayload?.identity_statement ?? ""), rank: insertPayload?.rank, created_at: "2026-09-14T00:00:00Z" },
      error: null,
    }));
    chain.then = (resolve: (v: Resp) => void) => {
      const inCall = calls.find((c) => c.method === "in" && c.args[0] === "status");
      const eqCall = calls.find((c) => c.method === "eq" && c.args[0] === "status");
      const statuses: string[] = inCall ? (inCall.args[1] as string[]) : eqCall ? [eqCall.args[1] as string] : [];
      const data = rows.filter((r) => statuses.includes(r.status)).map((r) => ({ rank: r.rank }));
      resolve({ data, error: null });
    };
    const from = vi.fn(() => chain);
    return { client: { from } as unknown as SupabaseClient, insertPayload: () => insertPayload, calls };
  }

  it("treats a PAUSED habit as occupying its rank slot -- 5 active + 2 paused at 7 total refuses with the friendly message, never a raw unique-violation insert attempt", async () => {
    const rows: { rank: number; status: "active" | "paused" }[] = [
      { rank: 1, status: "active" },
      { rank: 2, status: "active" },
      { rank: 4, status: "active" },
      { rank: 5, status: "active" },
      { rank: 7, status: "active" },
      { rank: 3, status: "paused" },
      { rank: 6, status: "paused" },
    ];
    const { client, insertPayload } = makeStatusAwareRankClient(rows);

    await expect(createIdentityHabitCore(client, "user-1", "the athlete")).rejects.toThrow(/already have 7/);
    expect(insertPayload()).toBeNull();
  });

  it("a rank slot vacated only by archiving (not pausing) is still picked up as free", async () => {
    // 6 active + 1 paused = 7 occupied ranks total is still full; but with
    // only 5 active + 1 paused (6 occupied), rank 7 must be offered.
    const rows: { rank: number; status: "active" | "paused" }[] = [
      { rank: 1, status: "active" },
      { rank: 2, status: "active" },
      { rank: 3, status: "active" },
      { rank: 4, status: "active" },
      { rank: 5, status: "active" },
      { rank: 6, status: "paused" },
    ];
    const { client, insertPayload } = makeStatusAwareRankClient(rows);

    const habit = await createIdentityHabitCore(client, "user-1", "the athlete");
    expect(habit.rank).toBe(7);
    expect(insertPayload()).toMatchObject({ rank: 7 });
  });
});

describe("archiveIdentityHabitCore", () => {
  it("scopes the update to this user's own active habit", async () => {
    const { client, calls } = makeClient({ identity_habits: [{ data: null, error: null }] });
    await archiveIdentityHabitCore(client, "user-1", "h1");

    const eqArgs = calls.identity_habits!.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["id", "h1"]);
    expect(eqArgs).toContainEqual(["user_id", "user-1"]);
    expect(eqArgs).toContainEqual(["status", "active"]);
    const updates = calls.identity_habits!.filter((c) => c.method === "update");
    expect(updates[0]!.args[0]).toMatchObject({ status: "archived" });
    expect((updates[0]!.args[0] as { archived_at: string }).archived_at).toBeTruthy();
  });
});

// P3-07
describe("pauseIdentityHabitCore", () => {
  it("flips status to 'paused' (scoped to this user's own active habit) THEN opens a pause-log row dated today", async () => {
    const { client, calls } = makeClient({
      identity_habits: [{ data: { id: "h1" }, error: null }],
      identity_habit_pauses: [{ data: null, error: null }],
    });
    await pauseIdentityHabitCore(client, "user-1", "h1", now, tz);

    const habitEq = calls.identity_habits!.filter((c) => c.method === "eq").map((c) => c.args);
    expect(habitEq).toContainEqual(["id", "h1"]);
    expect(habitEq).toContainEqual(["user_id", "user-1"]);
    expect(habitEq).toContainEqual(["status", "active"]);
    const habitUpdate = calls.identity_habits!.find((c) => c.method === "update");
    expect(habitUpdate!.args[0]).toEqual({ status: "paused" });

    const pauseInsert = calls.identity_habit_pauses!.find((c) => c.method === "insert");
    expect(pauseInsert!.args[0]).toMatchObject({ user_id: "user-1", habit_id: "h1", paused_at: "2026-09-14" });
  });

  it("a no-op status update (already paused/archived/foreign id) opens NO pause-log row at all", async () => {
    const { client, calls } = makeClient({ identity_habits: [{ data: null, error: null }] });
    await pauseIdentityHabitCore(client, "user-1", "h1", now, tz);

    expect(calls.identity_habit_pauses).toBeUndefined();
  });

  it("propagates a real database error from the status update without attempting the pause-log insert", async () => {
    const { client, calls } = makeClient({
      identity_habits: [{ data: null, error: new Error("db down") }],
    });
    await expect(pauseIdentityHabitCore(client, "user-1", "h1", now, tz)).rejects.toThrow("db down");
    expect(calls.identity_habit_pauses).toBeUndefined();
  });
});

describe("resumeIdentityHabitCore", () => {
  it("closes the open pause-log row (resumed_at = today) THEN flips status back to 'active'", async () => {
    const { client, calls } = makeClient({
      identity_habit_pauses: [{ data: null, error: null }],
      identity_habits: [{ data: null, error: null }],
    });
    await resumeIdentityHabitCore(client, "user-1", "h1", now, tz);

    const pauseEq = calls.identity_habit_pauses!.filter((c) => c.method === "eq").map((c) => c.args);
    expect(pauseEq).toContainEqual(["user_id", "user-1"]);
    expect(pauseEq).toContainEqual(["habit_id", "h1"]);
    const pauseIs = calls.identity_habit_pauses!.filter((c) => c.method === "is").map((c) => c.args);
    expect(pauseIs).toContainEqual(["resumed_at", null]);
    const pauseUpdate = calls.identity_habit_pauses!.find((c) => c.method === "update");
    expect(pauseUpdate!.args[0]).toEqual({ resumed_at: "2026-09-14" });

    const habitUpdate = calls.identity_habits!.find((c) => c.method === "update");
    expect(habitUpdate!.args[0]).toEqual({ status: "active" });
    const habitEq = calls.identity_habits!.filter((c) => c.method === "eq").map((c) => c.args);
    expect(habitEq).toContainEqual(["status", "paused"]);
  });

  it("propagates a real database error from closing the pause-log row without attempting the status flip", async () => {
    const { client, calls } = makeClient({
      identity_habit_pauses: [{ data: null, error: new Error("db down") }],
    });
    await expect(resumeIdentityHabitCore(client, "user-1", "h1", now, tz)).rejects.toThrow("db down");
    expect(calls.identity_habits).toBeUndefined();
  });
});

describe("killIdentityHabitCore (P2-11)", () => {
  it("below the escalation threshold: kills with no reason required, kill_reason stored as null", async () => {
    const { client, calls } = makeClient({
      habit_votes: [{ data: null, error: null, count: 5 }],
      identity_habits: [{ data: null, error: null }],
    });
    const result = await killIdentityHabitCore(client, "user-1", "h1");

    expect(result).toEqual({ ok: true });
    const updates = calls.identity_habits!.filter((c) => c.method === "update");
    expect(updates[0]!.args[0]).toMatchObject({ status: "archived", kill_reason: null });
  });

  it("THE REGRESSION GUARD: at/above the threshold, refuses without ever attempting the update when no reason is given", async () => {
    const { client, calls } = makeClient({
      habit_votes: [{ data: null, error: null, count: 14 }],
    });
    const result = await killIdentityHabitCore(client, "user-1", "h1");

    expect(result).toEqual({ ok: false, reason: "requires_reason" });
    expect(calls.identity_habits).toBeUndefined(); // .from("identity_habits") never even called
  });

  it("an all-whitespace reason is treated as no reason at all -- still refuses", async () => {
    const { client, calls } = makeClient({
      habit_votes: [{ data: null, error: null, count: 20 }],
    });
    const result = await killIdentityHabitCore(client, "user-1", "h1", "   \n  ");

    expect(result).toEqual({ ok: false, reason: "requires_reason" });
    expect(calls.identity_habits).toBeUndefined();
  });

  it("at/above the threshold WITH a real reason: kills and stores the trimmed reason", async () => {
    const { client, calls } = makeClient({
      habit_votes: [{ data: null, error: null, count: 30 }],
      identity_habits: [{ data: null, error: null }],
    });
    const result = await killIdentityHabitCore(client, "user-1", "h1", "  I no longer identify with this.  ");

    expect(result).toEqual({ ok: true });
    const updates = calls.identity_habits!.filter((c) => c.method === "update");
    expect(updates[0]!.args[0]).toMatchObject({ status: "archived", kill_reason: "I no longer identify with this." });
  });

  it("counts votes scoped to this user and this habit", async () => {
    const { client, calls } = makeClient({
      habit_votes: [{ data: null, error: null, count: 0 }],
      identity_habits: [{ data: null, error: null }],
    });
    await killIdentityHabitCore(client, "user-1", "h1");

    const eqArgs = calls.habit_votes!.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["user_id", "user-1"]);
    expect(eqArgs).toContainEqual(["habit_id", "h1"]);
  });

  it("scopes the update to this user's own active habit, same as archiveIdentityHabitCore", async () => {
    const { client, calls } = makeClient({
      habit_votes: [{ data: null, error: null, count: 0 }],
      identity_habits: [{ data: null, error: null }],
    });
    await killIdentityHabitCore(client, "user-1", "h1");

    const eqArgs = calls.identity_habits!.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["id", "h1"]);
    expect(eqArgs).toContainEqual(["user_id", "user-1"]);
    expect(eqArgs).toContainEqual(["status", "active"]);
  });

  it("a null count (a query hiccup) is treated as 0 votes, never crashes", async () => {
    const { client } = makeClient({
      habit_votes: [{ data: null, error: null, count: null }],
      identity_habits: [{ data: null, error: null }],
    });
    const result = await killIdentityHabitCore(client, "user-1", "h1");
    expect(result).toEqual({ ok: true });
  });

  it("propagates a genuine database error from the count query", async () => {
    const { client } = makeClient({
      habit_votes: [{ data: null, error: { message: "connection reset" } }],
    });
    await expect(killIdentityHabitCore(client, "user-1", "h1")).rejects.toMatchObject({ message: "connection reset" });
  });
});

describe("castHabitVoteCore / retractHabitVoteCore — today-only, server-enforced", () => {
  it("casts a vote for today via an idempotent upsert, never a read-then-branch", async () => {
    const { client, calls } = makeClient({ habit_votes: [{ data: null, error: null }] });
    await castHabitVoteCore(client, "user-1", "h1", today, now, tz);

    expect(calls.habit_votes!.some((c) => c.method === "select")).toBe(false);
    const upserts = calls.habit_votes!.filter((c) => c.method === "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.args[0]).toEqual({ user_id: "user-1", habit_id: "h1", date: today });
    expect(upserts[0]!.args[1]).toMatchObject({ ignoreDuplicates: true });
  });

  it("retracts today's vote via a direct delete, never a read-then-branch", async () => {
    const { client, calls } = makeClient({ habit_votes: [{ data: null, error: null }] });
    await retractHabitVoteCore(client, "user-1", "h1", today, now, tz);

    expect(calls.habit_votes!.some((c) => c.method === "select")).toBe(false);
    expect(calls.habit_votes!.some((c) => c.method === "delete")).toBe(true);
    const eqArgs = calls.habit_votes!.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["user_id", "user-1"]);
    expect(eqArgs).toContainEqual(["habit_id", "h1"]);
    expect(eqArgs).toContainEqual(["date", today]);
  });

  // THE RULED SECURITY PROPERTY: a request for anything but the caller's
  // own local today is rejected server-side, using the server's own
  // now()/timezone -- never trusting the date the caller sent, even though
  // the real UI only ever sends today's own date computed the same way.
  it("REJECTS a cast for yesterday's date even though the client sent it", async () => {
    const { client, calls } = makeClient({ habit_votes: [] });
    await expect(castHabitVoteCore(client, "user-1", "h1", yesterday, now, tz)).rejects.toThrow(/only be cast or retracted for today/);
    expect(client.from).not.toHaveBeenCalled();
    expect(calls.habit_votes ?? []).toHaveLength(0);
  });

  it("REJECTS a retraction for yesterday's date even though the client sent it", async () => {
    const { client } = makeClient({ habit_votes: [] });
    await expect(retractHabitVoteCore(client, "user-1", "h1", yesterday, now, tz)).rejects.toThrow(/only be cast or retracted for today/);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("computes 'today' from the server's own now()/timezone, not from the requested date string", async () => {
    // 11pm Pacific on the 13th is already the 14th in UTC ("now" above is
    // UTC-backed) -- a vote correctly dated by the CALLER's own timezone
    // must still be accepted, proving the comparison uses localDateString
    // against a real IANA zone rather than any naive UTC slice of `now`.
    const elevenPmPacific = new Date("2026-09-14T06:00:00.000Z"); // 2026-09-13 23:00 PDT
    const { client, calls } = makeClient({ habit_votes: [{ data: null, error: null }] });
    await castHabitVoteCore(client, "user-1", "h1", "2026-09-13", elevenPmPacific, "America/Los_Angeles");
    const upserts = calls.habit_votes!.filter((c) => c.method === "upsert");
    expect(upserts[0]!.args[0]).toMatchObject({ date: "2026-09-13" });
  });
});
