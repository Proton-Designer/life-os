import { describe, it, expect, vi } from "vitest";
import { getClassTasksDueSoonCore, CLASS_TASKS_WINDOW_DAYS } from "../session-setup-data";

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
