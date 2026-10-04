import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createMorningRoutineItemCore,
  archiveMorningRoutineItemCore,
  checkMorningRoutineItemCore,
  uncheckMorningRoutineItemCore,
  getMorningRoutineChecklistCore,
  setLaunchStepDoneCore,
  MAX_ROUTINE_ITEMS,
} from "../actions-core";

type Resp = { data: unknown; error: unknown; count?: number | null };
type Call = { method: string; args: unknown[] };

/** Same "per-table sequential queue" fake shape as lib/habits/__tests__/actions-core.test.ts's own makeClient. */
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
    for (const method of ["select", "eq", "insert", "update", "delete", "upsert", "order", "in", "is", "gte", "lte"]) {
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

describe("createMorningRoutineItemCore", () => {
  it("inserts a trimmed item when under the ceiling", async () => {
    const { client, calls } = makeClient({
      morning_routine_items: [
        { data: null, error: null, count: 2 }, // 2 active items already
        { data: { id: "i1", label: "Make the bed", created_at: "2026-09-14T00:00:00Z" }, error: null },
      ],
    });

    const item = await createMorningRoutineItemCore(client, "user-1", "  Make the bed  ");

    expect(item).toEqual({ id: "i1", label: "Make the bed", createdAt: "2026-09-14T00:00:00Z", ifCue: null, fallbackText: null, habitId: null });
    const inserts = calls.morning_routine_items!.filter((c) => c.method === "insert");
    expect(inserts[0]!.args[0]).toMatchObject({ user_id: "user-1", label: "Make the bed" });
  });

  it("rejects a blank label without querying the database", async () => {
    const { client } = makeClient({});
    await expect(createMorningRoutineItemCore(client, "user-1", "   ")).rejects.toThrow(/needs a label/);
    expect((client.from as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it(`refuses a ${MAX_ROUTINE_ITEMS + 1}th active item before ever attempting the insert`, async () => {
    const { client, calls } = makeClient({
      morning_routine_items: [{ data: null, error: null, count: MAX_ROUTINE_ITEMS }],
    });
    await expect(createMorningRoutineItemCore(client, "user-1", "One more")).rejects.toThrow(new RegExp(`already have ${MAX_ROUTINE_ITEMS}`));
    expect(calls.morning_routine_items!.some((c) => c.method === "insert")).toBe(false);
  });

  it("counts only ACTIVE items -- an archived item never counts against the ceiling", async () => {
    const { client, calls } = makeClient({
      morning_routine_items: [
        { data: null, error: null, count: 3 },
        { data: { id: "i2", label: "Stretch", created_at: "2026-09-14T00:00:00Z" }, error: null },
      ],
    });
    await createMorningRoutineItemCore(client, "user-1", "Stretch");
    const countCall = calls.morning_routine_items!.find((c) => c.method === "is");
    expect(countCall!.args).toEqual(["archived_at", null]);
  });

  it("propagates a real database error rather than swallowing it", async () => {
    const { client } = makeClient({
      morning_routine_items: [{ data: null, error: null, count: 0 }, { data: null, error: { code: "23505", message: "duplicate" } }],
    });
    await expect(createMorningRoutineItemCore(client, "user-1", "Stretch")).rejects.toMatchObject({ code: "23505" });
  });
});

describe("archiveMorningRoutineItemCore", () => {
  it("scopes the update to archived_at IS NULL, never a hard delete", async () => {
    const { client, calls } = makeClient({ morning_routine_items: [{ data: null, error: null }] });
    await archiveMorningRoutineItemCore(client, "user-1", "i1");

    const calledMethods = calls.morning_routine_items!.map((c) => c.method);
    expect(calledMethods).not.toContain("delete");
    expect(calledMethods).toContain("update");
    const updateCall = calls.morning_routine_items!.find((c) => c.method === "update");
    expect(updateCall!.args[0]).toHaveProperty("archived_at");
    const isCall = calls.morning_routine_items!.find((c) => c.method === "is");
    expect(isCall!.args).toEqual(["archived_at", null]);
  });

  it("is a true no-op for an already-archived or foreign id -- 0 rows, not an error", async () => {
    const { client } = makeClient({ morning_routine_items: [{ data: null, error: null }] });
    await expect(archiveMorningRoutineItemCore(client, "user-1", "already-archived-or-missing")).resolves.toBeUndefined();
  });
});

describe("checkMorningRoutineItemCore / uncheckMorningRoutineItemCore -- today-only, server-enforced", () => {
  it("check upserts with ignoreDuplicates against the (user,item,date) key", async () => {
    const { client, calls } = makeClient({ morning_routine_checks: [{ data: null, error: null }] });
    await checkMorningRoutineItemCore(client, "user-1", "i1", today, now, tz);

    const upsertCall = calls.morning_routine_checks!.find((c) => c.method === "upsert");
    expect(upsertCall!.args[0]).toEqual({ user_id: "user-1", item_id: "i1", checked_date: today });
    expect(upsertCall!.args[1]).toMatchObject({ onConflict: "user_id,item_id,checked_date", ignoreDuplicates: true });
  });

  it("check refuses a non-today date without touching the database", async () => {
    const { client } = makeClient({});
    await expect(checkMorningRoutineItemCore(client, "user-1", "i1", yesterday, now, tz)).rejects.toThrow(/only be checked or unchecked for today/);
    expect((client.from as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("uncheck deletes today's own row, and a 0-row match is a no-op, not an error", async () => {
    const { client, calls } = makeClient({ morning_routine_checks: [{ data: null, error: null }] });
    await expect(uncheckMorningRoutineItemCore(client, "user-1", "i1", today, now, tz)).resolves.toBeUndefined();
    expect(calls.morning_routine_checks!.some((c) => c.method === "delete")).toBe(true);
  });

  it("uncheck refuses a non-today date without touching the database", async () => {
    const { client } = makeClient({});
    await expect(uncheckMorningRoutineItemCore(client, "user-1", "i1", yesterday, now, tz)).rejects.toThrow(/only be checked or unchecked for today/);
    expect((client.from as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe("getMorningRoutineChecklistCore", () => {
  it("merges items with today's checks, in created_at order, active only", async () => {
    const { client, calls } = makeClient({
      morning_routine_items: [
        {
          data: [
            { id: "i1", label: "Make the bed", created_at: "2026-09-14T00:00:00Z" },
            { id: "i2", label: "Stretch", created_at: "2026-09-14T01:00:00Z" },
          ],
          error: null,
        },
      ],
      morning_routine_checks: [{ data: [{ item_id: "i1", checked_date: today }], error: null }],
    });

    const checklist = await getMorningRoutineChecklistCore(client, "user-1", now, tz);

    expect(checklist).toEqual([
      { id: "i1", label: "Make the bed", createdAt: "2026-09-14T00:00:00Z", ifCue: null, fallbackText: null, habitId: null, checkedToday: true, doneLast7: 1 },
      { id: "i2", label: "Stretch", createdAt: "2026-09-14T01:00:00Z", ifCue: null, fallbackText: null, habitId: null, checkedToday: false, doneLast7: 0 },
    ]);
    const isCall = calls.morning_routine_items!.find((c) => c.method === "is");
    expect(isCall!.args).toEqual(["archived_at", null]);
    // One range read (today-6 .. today) serves both "checked today" and "x of the last 7".
    expect(calls.morning_routine_checks!.find((c) => c.method === "gte")!.args).toEqual(["checked_date", "2026-09-08"]);
    expect(calls.morning_routine_checks!.find((c) => c.method === "lte")!.args).toEqual(["checked_date", today]);
  });

  it("returns [] without querying checks at all when there are no items", async () => {
    const { client, calls } = makeClient({ morning_routine_items: [{ data: [], error: null }] });
    const checklist = await getMorningRoutineChecklistCore(client, "user-1", now, tz);
    expect(checklist).toEqual([]);
    expect(calls.morning_routine_checks).toBeUndefined();
  });

  it("propagates a real database error from the items read", async () => {
    const { client } = makeClient({ morning_routine_items: [{ data: null, error: { message: "boom" } }] });
    await expect(getMorningRoutineChecklistCore(client, "user-1", now, tz)).rejects.toMatchObject({ message: "boom" });
  });
});

describe("IA-P4a — Launch-sequence steps", () => {
  it("the cap for NEW steps is 5", () => {
    expect(MAX_ROUTINE_ITEMS).toBe(5);
  });

  it("create stores the if-cue, the 2-minute version and an active linked habit", async () => {
    const { client, calls } = makeClient({
      morning_routine_items: [
        { data: null, error: null, count: 1 },
        { data: { id: "i9", label: "write one line", created_at: "t", if_cue: "I sit at my desk", fallback_text: "one word", habit_id: "h1" }, error: null },
      ],
      identity_habits: [{ data: { id: "h1" }, error: null }],
    });
    const item = await createMorningRoutineItemCore(client, "user-1", "write one line", { ifCue: " I sit at my desk ", fallbackText: "one word", habitId: "h1" });
    expect(item).toMatchObject({ ifCue: "I sit at my desk", fallbackText: "one word", habitId: "h1" });
    expect(calls.morning_routine_items!.find((c) => c.method === "insert")!.args[0]).toMatchObject({ if_cue: "I sit at my desk", fallback_text: "one word", habit_id: "h1" });
    expect(calls.identity_habits!.some((c) => c.method === "eq" && c.args[0] === "status" && c.args[1] === "active")).toBe(true);
  });

  it("create refuses a habit that isn't the caller's active habit, before inserting", async () => {
    const { client, calls } = makeClient({ morning_routine_items: [{ data: null, error: null, count: 0 }], identity_habits: [{ data: null, error: null }] });
    await expect(createMorningRoutineItemCore(client, "user-1", "x", { habitId: "other" })).rejects.toThrow(/isn't active/);
    expect(calls.morning_routine_items!.some((c) => c.method === "insert")).toBe(false);
  });

  it("create refuses an over-long cue", async () => {
    const { client } = makeClient({});
    await expect(createMorningRoutineItemCore(client, "user-1", "x", { ifCue: "a".repeat(81) })).rejects.toThrow(/80 characters/);
  });

  it("x of the last 7 counts distinct days in the window, ignoring older rows", async () => {
    const { client } = makeClient({
      morning_routine_items: [{ data: [{ id: "i1", label: "A", created_at: "t" }], error: null }],
      morning_routine_checks: [{ data: [{ item_id: "i1", checked_date: today }, { item_id: "i1", checked_date: yesterday }, { item_id: "i1", checked_date: "2026-09-01" }], error: null }],
    });
    const [item] = await getMorningRoutineChecklistCore(client, "user-1", now, tz);
    expect(item).toMatchObject({ checkedToday: true, doneLast7: 2 });
  });

  describe("setLaunchStepDoneCore", () => {
    const step = (habit: string | null) => ({ morning_routine_items: [{ data: { id: "i1", habit_id: habit }, error: null }] });

    it("done=true ticks today; a plain step writes no habit vote", async () => {
      const { client, calls } = makeClient({ ...step(null), morning_routine_checks: [{ data: null, error: null }] });
      await setLaunchStepDoneCore(client, "user-1", "i1", true, today, now, tz);
      expect(calls.morning_routine_checks!.some((c) => c.method === "upsert")).toBe(true);
      expect(calls.habit_votes).toBeUndefined();
    });

    it("a linked step ticks AND casts that habit's vote for the same local day", async () => {
      const { client, calls } = makeClient({ ...step("h1"), morning_routine_checks: [{ data: null, error: null }], habit_votes: [{ data: null, error: null }] });
      await setLaunchStepDoneCore(client, "user-1", "i1", true, today, now, tz);
      expect(calls.habit_votes!.find((c) => c.method === "upsert")!.args[0]).toEqual({ user_id: "user-1", habit_id: "h1", date: today });
    });

    it("done=false unticks and retracts the linked vote", async () => {
      const { client, calls } = makeClient({
        ...step("h1"),
        morning_routine_checks: [{ data: null, error: null }],
        identity_habits: [{ data: { id: "h1" }, error: null }],
        habit_votes: [{ data: null, error: null }],
      });
      await setLaunchStepDoneCore(client, "user-1", "i1", false, today, now, tz);
      expect(calls.morning_routine_checks!.some((c) => c.method === "delete")).toBe(true);
      expect(calls.habit_votes!.some((c) => c.method === "delete")).toBe(true);
    });

    it("if the linked vote is refused, the tick is put back and the error surfaces", async () => {
      const { client, calls } = makeClient({
        ...step("h1"),
        morning_routine_checks: [{ data: null, error: null }, { data: null, error: null }],
        habit_votes: [{ data: null, error: { message: "paused" } }],
      });
      await expect(setLaunchStepDoneCore(client, "user-1", "i1", true, today, now, tz)).rejects.toMatchObject({ message: "paused" });
      const methods = calls.morning_routine_checks!.map((c) => c.method);
      expect(methods.indexOf("upsert")).toBeGreaterThanOrEqual(0);
      expect(methods).toContain("delete"); // the rollback
    });

    it("refuses another day and a missing/archived step without writing", async () => {
      const a = makeClient({});
      await expect(setLaunchStepDoneCore(a.client, "user-1", "i1", true, yesterday, now, tz)).rejects.toThrow(/only be checked/);
      const b = makeClient({ morning_routine_items: [{ data: null, error: null }] });
      await expect(setLaunchStepDoneCore(b.client, "user-1", "i1", true, today, now, tz)).rejects.toThrow(/No morning routine item found/);
      expect(b.calls.morning_routine_checks).toBeUndefined();
    });
  });
});
