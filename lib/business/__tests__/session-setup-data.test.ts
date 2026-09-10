import { describe, it, expect, vi } from "vitest";
import { getClassTasksDueSoonCore, CLASS_TASKS_WINDOW_DAYS, toKillListObjectiveOptions, getUserClassesCore } from "../session-setup-data";
import type { KillListSlotData } from "@/components/business/kill-list";

type Row = Record<string, unknown>;

// Same fake shape as lib/school/__tests__/get-class-cards.test.ts — a
// thenable chain supporting .eq/.not/.gte/.lte/.order in any order,
// resolving to { data, error }.
function makeSelectResult(rows: Row[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not", "gte", "lte", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows, error: null });
  return chain;
}

function makeFakeSupabase(rows: Row[]) {
  return { from: vi.fn(() => makeSelectResult(rows)) };
}

function task(id: string, dueDate: string): Row {
  return { id, title: `Task ${id}`, due_date: dueDate };
}

describe("getClassTasksDueSoonCore", () => {
  const TODAY = "2026-09-10";

  it("returns tasks mapped to id/title/dueDate", async () => {
    const supabase = makeFakeSupabase([task("t1", TODAY)]);
    const result = await getClassTasksDueSoonCore(supabase as never, "u1", "c1", TODAY);
    expect(result).toEqual([{ id: "t1", title: "Task t1", dueDate: TODAY }]);
  });

  it("scopes the query to the given user and class", async () => {
    const supabase = makeFakeSupabase([]);
    await getClassTasksDueSoonCore(supabase as never, "u1", "c1", TODAY);
    const chain = supabase.from.mock.results[0]!.value;
    expect(chain.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(chain.eq).toHaveBeenCalledWith("class_id", "c1");
    expect(chain.eq).toHaveBeenCalledWith("completed", false);
  });

  it(`windows the query to today through today + ${CLASS_TASKS_WINDOW_DAYS} days`, async () => {
    const supabase = makeFakeSupabase([]);
    await getClassTasksDueSoonCore(supabase as never, "u1", "c1", TODAY);
    const chain = supabase.from.mock.results[0]!.value;
    expect(chain.gte).toHaveBeenCalledWith("due_date", TODAY);
    expect(chain.lte).toHaveBeenCalledWith("due_date", "2026-09-24");
  });

  it("excludes null due dates", async () => {
    const supabase = makeFakeSupabase([]);
    await getClassTasksDueSoonCore(supabase as never, "u1", "c1", TODAY);
    const chain = supabase.from.mock.results[0]!.value;
    expect(chain.not).toHaveBeenCalledWith("due_date", "is", null);
  });

  it("orders soonest-due first", async () => {
    const supabase = makeFakeSupabase([]);
    await getClassTasksDueSoonCore(supabase as never, "u1", "c1", TODAY);
    const chain = supabase.from.mock.results[0]!.value;
    expect(chain.order).toHaveBeenCalledWith("due_date", { ascending: true });
  });

  it("throws on a query error rather than silently returning an empty list", async () => {
    const supabase = {
      from: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq", "not", "gte", "lte", "order"]) chain[method] = vi.fn(() => chain);
        chain.then = (resolve: (v: { data: null; error: Error }) => void) => resolve({ data: null, error: new Error("boom") });
        return chain;
      }),
    };
    await expect(getClassTasksDueSoonCore(supabase as never, "u1", "c1", TODAY)).rejects.toThrow("boom");
  });

  it("returns an empty list, not an error, when a class has no candidate tasks", async () => {
    const supabase = makeFakeSupabase([]);
    const result = await getClassTasksDueSoonCore(supabase as never, "u1", "c1", TODAY);
    expect(result).toEqual([]);
  });
});

describe("toKillListObjectiveOptions", () => {
  function slot(overrides: Partial<KillListSlotData> = {}): KillListSlotData {
    return { id: null, text: "", completed: false, ...overrides };
  }

  it("drops empty slots (id: null)", () => {
    const slots = [slot(), slot({ id: "k1", text: "Real item" })];
    expect(toKillListObjectiveOptions(slots)).toEqual([{ id: "k1", text: "Real item" }]);
  });

  it("drops already-completed items", () => {
    const slots = [
      slot({ id: "k1", text: "Done already", completed: true }),
      slot({ id: "k2", text: "Still open", completed: false }),
    ];
    expect(toKillListObjectiveOptions(slots)).toEqual([{ id: "k2", text: "Still open" }]);
  });

  it("returns an empty array when every slot is empty or completed", () => {
    const slots = [slot(), slot({ id: "k1", text: "Done", completed: true })];
    expect(toKillListObjectiveOptions(slots)).toEqual([]);
  });

  it("preserves slot order", () => {
    const slots = [slot({ id: "k1", text: "First" }), slot({ id: "k2", text: "Second" })];
    expect(toKillListObjectiveOptions(slots).map((o) => o.id)).toEqual(["k1", "k2"]);
  });
});

describe("getUserClassesCore", () => {
  it("labels each class with short_name, falling back to code", async () => {
    const supabase = makeFakeSupabase([
      { id: "c1", short_name: "DSA", code: "CS-3341" },
      { id: "c2", short_name: null, code: "MATH-2418" },
    ]);
    const result = await getUserClassesCore(supabase as never, "u1");
    expect(result).toEqual([
      { id: "c1", label: "DSA" },
      { id: "c2", label: "MATH-2418" },
    ]);
  });

  it("returns an empty array when the user has no classes", async () => {
    const supabase = makeFakeSupabase([]);
    const result = await getUserClassesCore(supabase as never, "u1");
    expect(result).toEqual([]);
  });

  it("scopes to the given user and orders by position", async () => {
    const supabase = makeFakeSupabase([]);
    await getUserClassesCore(supabase as never, "u1");
    const chain = supabase.from.mock.results[0]!.value;
    expect(chain.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(chain.order).toHaveBeenCalledWith("position", { ascending: true });
  });
});
