import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureCore, logEventCore, saveActionPlanCore, recordPlanOutcomeCore } from "../actions-core";

/**
 * Per-table fake client, same shape as lib/mcp/__tests__/write-registry-
 * school.test.ts's own `makeClient` — FIFO `maybeSingleSeq`/`singleSeq`
 * queues per table, since several core functions here make more than one
 * sequential call against the SAME table (e.g. `captureCore`'s insert-then-
 * conflict-lookup on `distraction_triggers`, or `logEventCore`'s ownership
 * check then `insertEventCore`'s own insert).
 */
function makeClient(
  opts: {
    maybeSingleSeq?: Record<string, unknown[]>;
    singleSeq?: Record<string, unknown[]>;
    insertErrorSeq?: Record<string, (unknown | null)[]>;
    rpcResult?: { data?: unknown; error?: unknown };
  } = {},
) {
  const maybeSingleSeq: Record<string, unknown[]> = Object.fromEntries(Object.entries(opts.maybeSingleSeq ?? {}).map(([k, v]) => [k, [...v]]));
  const singleSeq: Record<string, unknown[]> = Object.fromEntries(Object.entries(opts.singleSeq ?? {}).map(([k, v]) => [k, [...v]]));
  const insertErrorSeq: Record<string, (unknown | null)[]> = Object.fromEntries(Object.entries(opts.insertErrorSeq ?? {}).map(([k, v]) => [k, [...v]]));
  const calls: Record<string, { insert: Record<string, unknown>[]; update: Record<string, unknown>[]; eq: unknown[][] }> = {};

  const from = vi.fn((table: string) => {
    calls[table] ??= { insert: [], update: [], eq: [] };
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((...args: unknown[]) => {
      calls[table].eq.push(args);
      return chain;
    });
    chain.ilike = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      calls[table].insert.push(row);
      return chain;
    });
    chain.update = vi.fn((row: Record<string, unknown>) => {
      calls[table].update.push(row);
      return chain;
    });
    chain.maybeSingle = vi.fn(async () => ({ data: (maybeSingleSeq[table] ?? []).shift() ?? null, error: null }));
    chain.single = vi.fn(async () => {
      const err = (insertErrorSeq[table] ?? []).shift();
      if (err) return { data: null, error: err };
      return { data: (singleSeq[table] ?? []).shift() ?? { id: "new-id" }, error: null };
    });
    // Bare `.eq(...)` chains resolving as an update/delete terminator (no .select().single() after) — matches update() calls in the real code.
    chain.then = (resolve: (v: { error: null }) => void) => resolve({ error: null });
    return chain;
  });

  const rpc = vi.fn(async () => opts.rpcResult ?? { data: null, error: null });

  return { client: { from, rpc } as unknown as SupabaseClient, calls };
}

const now = new Date("2026-09-08T20:00:00.000Z"); // 15:00 CDT
const tz = "America/Chicago";

describe("captureCore — \"I just got distracted by my phone\"", () => {
  it("creates a new trigger and logs an event against it", async () => {
    const { client, calls } = makeClient({ singleSeq: { distraction_triggers: [{ id: "trig-1" }], distraction_events: [{ id: "event-1" }] } });

    const result = await captureCore(client, "user-1", tz, now, "deen", "phone during dhikr", "picking it up mid-adhkar", undefined);

    expect(result).toEqual({ triggerId: "trig-1", eventId: "event-1", reflectionEntryId: null });
    expect(calls.distraction_triggers.insert[0]).toMatchObject({ user_id: "user-1", domain: "deen", name: "phone during dhikr", description: "picking it up mid-adhkar" });
    expect(calls.distraction_events.insert[0]).toMatchObject({ user_id: "user-1", trigger_id: "trig-1", date: "2026-09-08" });
  });

  it("reuses the existing non-archived trigger on a 23505 name conflict — idempotent, never duplicates", async () => {
    const { client, calls } = makeClient({
      insertErrorSeq: { distraction_triggers: [{ code: "23505" }] },
      maybeSingleSeq: {},
      singleSeq: { distraction_triggers: [{ id: "existing-trig" }], distraction_events: [{ id: "event-2" }] },
    });

    const result = await captureCore(client, "user-1", tz, now, "deen", "phone during dhikr", null, undefined);

    expect(result.triggerId).toBe("existing-trig");
    expect(calls.distraction_events.insert[0]).toMatchObject({ trigger_id: "existing-trig" });
  });

  it("propagates a non-23505 insert error rather than treating it as a dedup hit", async () => {
    const { client } = makeClient({ insertErrorSeq: { distraction_triggers: [{ code: "23514", message: "check violated" }] } });
    await expect(captureCore(client, "user-1", tz, now, "deen", "x", null, undefined)).rejects.toMatchObject({ code: "23514" });
  });

  it("writes a linked reflection_entries row when a tier is given, and links it on the event", async () => {
    const { client, calls } = makeClient({
      singleSeq: { distraction_triggers: [{ id: "trig-1" }], reflection_entries: [{ id: "refl-1" }], distraction_events: [{ id: "event-1" }] },
    });

    await captureCore(client, "user-1", tz, now, "deen", "phone", null, 2);

    expect(calls.reflection_entries.insert[0]).toMatchObject({ user_id: "user-1", date: "2026-09-08", tier: 2 });
    expect(calls.distraction_events.insert[0]).toMatchObject({ reflection_tier: 2, reflection_entry_id: "refl-1" });
  });

  it("rejects an unknown domain", async () => {
    const { client } = makeClient();
    await expect(captureCore(client, "user-1", tz, now, "sleep", "x", null, undefined)).rejects.toThrow(/patch\.domain must be one of/i);
  });

  it("rejects a blank name", async () => {
    const { client } = makeClient();
    await expect(captureCore(client, "user-1", tz, now, "deen", "   ", null, undefined)).rejects.toThrow(/non-empty string/i);
  });

  it("rejects an out-of-range tier", async () => {
    const { client } = makeClient();
    await expect(captureCore(client, "user-1", tz, now, "deen", "x", null, 4)).rejects.toThrow(/patch\.tier must be 1, 2, or 3/i);
  });

  // AGENTS.md's rule: pin the exact UTC-rollover boundary, both sides.
  it("18:59 local (Chicago, UTC-5) and 19:01 local both land on the SAME local date, even though UTC has already rolled over between them", async () => {
    const { client: c1, calls: calls1 } = makeClient({ singleSeq: { distraction_triggers: [{ id: "t1" }], distraction_events: [{ id: "e1" }] } });
    await captureCore(c1, "user-1", tz, new Date("2026-09-08T23:59:00.000Z"), "deen", "x", null, undefined); // 18:59 CDT
    expect(calls1.distraction_events.insert[0]).toMatchObject({ date: "2026-09-08" });

    const { client: c2, calls: calls2 } = makeClient({ singleSeq: { distraction_triggers: [{ id: "t2" }], distraction_events: [{ id: "e2" }] } });
    await captureCore(c2, "user-1", tz, new Date("2026-09-09T00:01:00.000Z"), "deen", "x", null, undefined); // 19:01 CDT, still the 8th locally
    expect(calls2.distraction_events.insert[0]).toMatchObject({ date: "2026-09-08" });
  });

  it("a timezone EAST of UTC (the inverse case) also derives the correct local date", async () => {
    const { client, calls } = makeClient({ singleSeq: { distraction_triggers: [{ id: "t1" }], distraction_events: [{ id: "e1" }] } });
    // 01:30 UTC on the 9th == 10:30 Asia/Tokyo (UTC+9) on the 9th -- no rollover here, but a UTC-naive implementation shifted a day forward would fail this the other direction on a different instant. Confirms date-utils' localDateString is actually being used, not a raw Date field.
    await captureCore(client, "user-1", "Asia/Tokyo", new Date("2026-09-09T01:30:00.000Z"), "deen", "x", null, undefined);
    expect(calls.distraction_events.insert[0]).toMatchObject({ date: "2026-09-09" });
  });

  it("#52: threads an optional sessionId onto the event insert when given", async () => {
    const { client, calls } = makeClient({ singleSeq: { distraction_triggers: [{ id: "trig-1" }], distraction_events: [{ id: "event-1" }] } });
    await captureCore(client, "user-1", tz, now, "deen", "phone", null, undefined, "session-1");
    expect(calls.distraction_events.insert[0]).toMatchObject({ session_id: "session-1" });
  });

  it("#52: writes session_id: null when no session is active (the common case) rather than omitting the column", async () => {
    const { client, calls } = makeClient({ singleSeq: { distraction_triggers: [{ id: "trig-1" }], distraction_events: [{ id: "event-1" }] } });
    await captureCore(client, "user-1", tz, now, "deen", "phone", null, undefined);
    expect(calls.distraction_events.insert[0]).toMatchObject({ session_id: null });
  });
});

describe("logEventCore — logging against an ALREADY-KNOWN trigger", () => {
  it("verifies ownership before logging, and logs successfully when it belongs to this user", async () => {
    const { client, calls } = makeClient({ maybeSingleSeq: { distraction_triggers: [{ id: "trig-1" }] }, singleSeq: { distraction_events: [{ id: "event-1" }] } });
    const result = await logEventCore(client, "user-1", tz, now, "trig-1", undefined);
    expect(result).toEqual({ eventId: "event-1", reflectionEntryId: null });
    expect(calls.distraction_triggers.eq).toContainEqual(["id", "trig-1"]);
    expect(calls.distraction_triggers.eq).toContainEqual(["user_id", "user-1"]);
  });

  it("REJECTS logging against a trigger that doesn't belong to this user (or doesn't exist) — added on top of the original insertEvent, which trusted the caller-supplied id with no ownership check at all", async () => {
    const { client, calls } = makeClient({ maybeSingleSeq: { distraction_triggers: [null] } });
    await expect(logEventCore(client, "user-1", tz, now, "someone-elses-trigger", undefined)).rejects.toThrow(/no trigger found/i);
    // And critically: the event insert must never have been attempted.
    expect(calls.distraction_events).toBeUndefined();
  });

  it("rejects a missing trigger_id", async () => {
    const { client } = makeClient();
    await expect(logEventCore(client, "user-1", tz, now, undefined, undefined)).rejects.toThrow(/patch\.trigger_id is required/i);
  });

  it("#52: threads an optional sessionId onto the event insert when given", async () => {
    const { client, calls } = makeClient({ maybeSingleSeq: { distraction_triggers: [{ id: "trig-1" }] }, singleSeq: { distraction_events: [{ id: "event-1" }] } });
    await logEventCore(client, "user-1", tz, now, "trig-1", undefined, "session-1");
    expect(calls.distraction_events.insert[0]).toMatchObject({ session_id: "session-1" });
  });
});

describe("saveActionPlanCore — write or edit the current plan", () => {
  it("edits the current version's body in place when one exists (no version bump, no RPC call)", async () => {
    const { client, calls } = makeClient({
      maybeSingleSeq: { distraction_triggers: [{ id: "trig-1" }], trigger_action_plans: [{ id: "plan-1" }] },
    });
    const result = await saveActionPlanCore(client, "user-1", "trig-1", "new body");
    expect(result).toEqual({ triggerId: "trig-1", createdNewVersion: false });
    expect(calls.trigger_action_plans.update[0]).toEqual({ body: "new body" });
  });

  it("creates version 1 via save_trigger_plan when no current plan exists", async () => {
    const { client } = makeClient({
      maybeSingleSeq: { distraction_triggers: [{ id: "trig-1" }], trigger_action_plans: [null] },
      rpcResult: { data: { id: "plan-1", version: 1 }, error: null },
    });
    const result = await saveActionPlanCore(client, "user-1", "trig-1", "first plan");
    expect(result).toEqual({ triggerId: "trig-1", createdNewVersion: true });
    expect(client.rpc).toHaveBeenCalledWith("save_trigger_plan", { p_trigger_id: "trig-1", p_body: "first plan" });
  });

  it("verifies trigger ownership before touching any plan row", async () => {
    const { client } = makeClient({ maybeSingleSeq: { distraction_triggers: [null] } });
    await expect(saveActionPlanCore(client, "user-1", "not-mine", "body")).rejects.toThrow(/no trigger found/i);
  });

  it("rejects a blank body", async () => {
    const { client } = makeClient({ maybeSingleSeq: { distraction_triggers: [{ id: "trig-1" }] } });
    await expect(saveActionPlanCore(client, "user-1", "trig-1", "   ")).rejects.toThrow(/non-empty string/i);
  });
});

describe("recordPlanOutcomeCore — \"that plan didn't work\"", () => {
  it("calls record_plan_outcome with the local date when a current plan exists", async () => {
    const { client } = makeClient({
      maybeSingleSeq: { distraction_triggers: [{ id: "trig-1" }], trigger_action_plans: [{ id: "plan-1" }] },
      rpcResult: { data: null, error: null },
    });
    const result = await recordPlanOutcomeCore(client, "user-1", tz, now, "trig-1", false, undefined);
    expect(result).toEqual({ triggerId: "trig-1", date: "2026-09-08", followed: false });
    expect(client.rpc).toHaveBeenCalledWith("record_plan_outcome", { p_trigger_id: "trig-1", p_followed: false, p_date: "2026-09-08", p_new_plan_body: null });
  });

  it("gives a friendly, actionable message when the trigger has no plan yet — never the RPC's own opaque 'no current plan for trigger <uuid>'", async () => {
    const { client } = makeClient({ maybeSingleSeq: { distraction_triggers: [{ id: "trig-1" }], trigger_action_plans: [null] } });
    await expect(recordPlanOutcomeCore(client, "user-1", tz, now, "trig-1", true, "new body")).rejects.toThrow(/call distractions\.action_plan\.save first/i);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("propagates the RPC's own forced-rewrite error verbatim — never re-derives the 3-skip rule client-side", async () => {
    const { client } = makeClient({
      maybeSingleSeq: { distraction_triggers: [{ id: "trig-1" }], trigger_action_plans: [{ id: "plan-1" }] },
      rpcResult: { data: null, error: { message: "newPlanBody is required: this plan has never once survived contact" } },
    });
    await expect(recordPlanOutcomeCore(client, "user-1", tz, now, "trig-1", false, undefined)).rejects.toThrow(/never once survived contact/);
  });

  it("rejects a non-boolean followed", async () => {
    const { client } = makeClient({ maybeSingleSeq: { distraction_triggers: [{ id: "trig-1" }] } });
    await expect(recordPlanOutcomeCore(client, "user-1", tz, now, "trig-1", "yes", undefined)).rejects.toThrow(/patch\.followed is required/i);
  });
});
