import { describe, it, expect, vi } from "vitest";
import { loadSessionObjectivesCore } from "../session-objectives";

type Row = Record<string, unknown>;

// Table-routed fake — each table gets its own fluent chain resolving to
// { data, error }, matching lib/school/__tests__/get-class-cards.test.ts's
// pattern (the one already proven to work for a multi-table read).
function makeChain(rows: Row[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows, error: null });
  return chain;
}

function makeFakeSupabase(tables: {
  work_session_objectives?: Row[];
  kill_list_items?: Row[];
  tasks?: Row[];
}) {
  const chains: Record<string, ReturnType<typeof makeChain>> = {
    work_session_objectives: makeChain(tables.work_session_objectives ?? []),
    kill_list_items: makeChain(tables.kill_list_items ?? []),
    tasks: makeChain(tables.tasks ?? []),
  };
  return { from: vi.fn((table: string) => chains[table]), chains };
}

function objectiveRow(overrides: Row = {}): Row {
  return {
    id: "obj-1",
    kind: "custom",
    custom_text: "Draft the intro",
    completed: false,
    kill_list_item_id: null,
    task_id: null,
    ...overrides,
  };
}

describe("loadSessionObjectivesCore", () => {
  it("returns an empty array when the session has no objectives", async () => {
    const supabase = makeFakeSupabase({ work_session_objectives: [] });
    const result = await loadSessionObjectivesCore(supabase as never, "u1", "s1");
    expect(result).toEqual([]);
    // No point querying kill_list_items/tasks when there's nothing to join.
    expect(supabase.chains.kill_list_items.select).not.toHaveBeenCalled();
    expect(supabase.chains.tasks.select).not.toHaveBeenCalled();
  });

  it("maps a custom objective from its own completed/custom_text columns, no join", async () => {
    const supabase = makeFakeSupabase({
      work_session_objectives: [objectiveRow({ id: "obj-1", kind: "custom", custom_text: "Draft the intro", completed: true })],
    });
    const result = await loadSessionObjectivesCore(supabase as never, "u1", "s1");
    expect(result).toEqual([{ id: "obj-1", kind: "custom", label: "Draft the intro", completed: true, refId: null }]);
  });

  it("derives a kill_list_item objective's label/completed from the LIVE kill_list_items row, not this table's own completed column", async () => {
    const supabase = makeFakeSupabase({
      work_session_objectives: [
        // This row's own `completed` is stale/false — the derived value must
        // come from the joined kill_list_items row (true) instead.
        objectiveRow({ id: "obj-1", kind: "kill_list_item", custom_text: null, completed: false, kill_list_item_id: "k1" }),
      ],
      kill_list_items: [{ id: "k1", text: "Ship it", completed: true }],
    });
    const result = await loadSessionObjectivesCore(supabase as never, "u1", "s1");
    expect(result).toEqual([{ id: "obj-1", kind: "kill_list_item", label: "Ship it", completed: true, refId: "k1" }]);
  });

  it("derives a task objective's label/completed from the LIVE tasks row", async () => {
    const supabase = makeFakeSupabase({
      work_session_objectives: [objectiveRow({ id: "obj-1", kind: "task", custom_text: null, completed: false, task_id: "t1" })],
      tasks: [{ id: "t1", title: "Lab report", completed: true }],
    });
    const result = await loadSessionObjectivesCore(supabase as never, "u1", "s1");
    expect(result).toEqual([{ id: "obj-1", kind: "task", label: "Lab report", completed: true, refId: "t1" }]);
  });

  it("treats a missing join row as absent, not completed=true — never invents a value for a deleted reference", async () => {
    const supabase = makeFakeSupabase({
      work_session_objectives: [objectiveRow({ id: "obj-1", kind: "kill_list_item", custom_text: null, kill_list_item_id: "k1" })],
      kill_list_items: [], // deleted/not found
    });
    const result = await loadSessionObjectivesCore(supabase as never, "u1", "s1");
    expect(result).toEqual([{ id: "obj-1", kind: "kill_list_item", label: "", completed: false, refId: "k1" }]);
  });

  it("orders by position and only queries kill_list_items/tasks for the kinds actually present", async () => {
    const supabase = makeFakeSupabase({
      work_session_objectives: [objectiveRow({ id: "obj-1", kind: "custom" })],
    });
    await loadSessionObjectivesCore(supabase as never, "u1", "s1");
    expect(supabase.chains.work_session_objectives.order).toHaveBeenCalledWith("position", { ascending: true });
    expect(supabase.chains.kill_list_items.select).not.toHaveBeenCalled();
    expect(supabase.chains.tasks.select).not.toHaveBeenCalled();
  });

  it("scopes the kill_list_items/tasks joins to the given user", async () => {
    const supabase = makeFakeSupabase({
      work_session_objectives: [
        objectiveRow({ id: "obj-1", kind: "kill_list_item", custom_text: null, kill_list_item_id: "k1" }),
        objectiveRow({ id: "obj-2", kind: "task", custom_text: null, task_id: "t1" }),
      ],
      kill_list_items: [{ id: "k1", text: "Ship it", completed: false }],
      tasks: [{ id: "t1", title: "Lab report", completed: false }],
    });
    await loadSessionObjectivesCore(supabase as never, "u1", "s1");
    expect(supabase.chains.kill_list_items.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(supabase.chains.tasks.eq).toHaveBeenCalledWith("user_id", "u1");
  });

  it("handles a mix of all three kinds together, preserving order", async () => {
    const supabase = makeFakeSupabase({
      work_session_objectives: [
        objectiveRow({ id: "obj-1", kind: "kill_list_item", custom_text: null, kill_list_item_id: "k1" }),
        objectiveRow({ id: "obj-2", kind: "task", custom_text: null, task_id: "t1" }),
        objectiveRow({ id: "obj-3", kind: "custom", custom_text: "Wrap up", completed: false }),
      ],
      kill_list_items: [{ id: "k1", text: "Ship it", completed: false }],
      tasks: [{ id: "t1", title: "Lab report", completed: true }],
    });
    const result = await loadSessionObjectivesCore(supabase as never, "u1", "s1");
    expect(result.map((o) => o.id)).toEqual(["obj-1", "obj-2", "obj-3"]);
    expect(result[1]).toEqual({ id: "obj-2", kind: "task", label: "Lab report", completed: true, refId: "t1" });
  });
});
