import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createIdentityHabitCore,
  archiveIdentityHabitCore,
  castHabitVoteCore,
  retractHabitVoteCore,
  MAX_ACTIVE_HABITS,
} from "../actions-core";

type Resp = { data: unknown; error: unknown };
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
    for (const method of ["select", "eq", "insert", "update", "delete", "upsert", "order", "in"]) {
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
    await expect(createIdentityHabitCore(client, "user-1", "the athlete")).rejects.toThrow(/already have 7 active habits/);
    expect(calls.identity_habits!.some((c) => c.method === "insert")).toBe(false);
  });

  it("propagates a real database error (e.g. a genuine cross-tab rank race) rather than swallowing it", async () => {
    const { client } = makeClient({
      identity_habits: [{ data: [], error: null }, { data: null, error: { code: "23505", message: "duplicate key" } }],
    });
    await expect(createIdentityHabitCore(client, "user-1", "the athlete")).rejects.toMatchObject({ code: "23505" });
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
