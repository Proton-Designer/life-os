import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTodaysTimeboxedTasks } from "../timebox";

type Row = { id: string; title: string; mit_rank: number | null; planned_start_time: string | null; completed: boolean };
type Call = { method: string; args: unknown[] };

function makeClient(rows: Row[]) {
  const calls: Call[] = [];
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "not"]) {
      chain[method] = vi.fn((...args: unknown[]) => {
        calls.push({ method, args });
        return chain;
      });
    }
    chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => resolve({ data: rows, error: null });
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

function row(overrides: Partial<Row> = {}): Row {
  return { id: "t1", title: "Task", mit_rank: 1, planned_start_time: null, completed: false, ...overrides };
}

describe("getTodaysTimeboxedTasks", () => {
  it("scopes the query to this user, this planned_date, and mit_rank IS NOT NULL", async () => {
    const { client, calls } = makeClient([]);
    await getTodaysTimeboxedTasks(client, "u1", "2026-09-15");
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "user_id" && c.args[1] === "u1")).toBe(true);
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "planned_date" && c.args[1] === "2026-09-15")).toBe(true);
    expect(calls.some((c) => c.method === "not" && c.args[0] === "mit_rank" && c.args[1] === "is" && c.args[2] === null)).toBe(true);
  });

  it("no items -- empty array, not an error", async () => {
    const { client } = makeClient([]);
    const result = await getTodaysTimeboxedTasks(client, "u1", "2026-09-15");
    expect(result).toEqual([]);
  });

  it("orders scheduled items by start time ascending", async () => {
    const { client } = makeClient([
      row({ id: "a", mit_rank: 2, planned_start_time: "14:00" }),
      row({ id: "b", mit_rank: 1, planned_start_time: "09:00" }),
      row({ id: "c", mit_rank: 3, planned_start_time: "11:30" }),
    ]);
    const result = await getTodaysTimeboxedTasks(client, "u1", "2026-09-15");
    expect(result.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("scheduled items sort BEFORE unscheduled ones -- an unscheduled item has no place on a timeline", async () => {
    const { client } = makeClient([
      row({ id: "unscheduled", mit_rank: 1, planned_start_time: null }),
      row({ id: "scheduled", mit_rank: 3, planned_start_time: "16:00" }),
    ]);
    const result = await getTodaysTimeboxedTasks(client, "u1", "2026-09-15");
    expect(result.map((t) => t.id)).toEqual(["scheduled", "unscheduled"]);
  });

  it("two items sharing the same start time break the tie by mit_rank (crown order)", async () => {
    const { client } = makeClient([
      row({ id: "second", mit_rank: 2, planned_start_time: "09:00" }),
      row({ id: "first", mit_rank: 1, planned_start_time: "09:00" }),
    ]);
    const result = await getTodaysTimeboxedTasks(client, "u1", "2026-09-15");
    expect(result.map((t) => t.id)).toEqual(["first", "second"]);
  });

  it("multiple unscheduled items fall back to mit_rank (crown order) among themselves", async () => {
    const { client } = makeClient([
      row({ id: "starred-2", mit_rank: 2, planned_start_time: null }),
      row({ id: "crowned", mit_rank: 1, planned_start_time: null }),
      row({ id: "starred-3", mit_rank: 3, planned_start_time: null }),
    ]);
    const result = await getTodaysTimeboxedTasks(client, "u1", "2026-09-15");
    expect(result.map((t) => t.id)).toEqual(["crowned", "starred-2", "starred-3"]);
  });

  it("a completed item stays on the timeline (with completed: true), not silently dropped", async () => {
    const { client } = makeClient([row({ id: "done", completed: true, planned_start_time: "08:00" })]);
    const result = await getTodaysTimeboxedTasks(client, "u1", "2026-09-15");
    expect(result).toEqual([{ id: "done", title: "Task", mitRank: 1, plannedStartTime: "08:00", completed: true }]);
  });
});
