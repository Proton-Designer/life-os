import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction, listWriteEntities, listWriteActions } from "../write-registry";

function textOf(outcome: Awaited<ReturnType<NonNullable<ReturnType<typeof getWriteAction>>["handler"]>>) {
  const block = outcome.result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return JSON.parse(block.text);
}

/** A generic fake client covering every query shape work/business's handlers make: insert->select->single, update, select->eq->maybeSingle, and rpc. */
function makeClient(opts: { maybeSingle?: unknown; insertId?: string; rpcError?: unknown } = {}) {
  const updateCalls: Record<string, unknown>[] = [];
  const insertCalls: Record<string, unknown>[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "is"]) chain[m] = vi.fn(() => chain);
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      insertCalls.push(row);
      return chain;
    });
    chain.update = vi.fn((row: Record<string, unknown>) => {
      updateCalls.push(row);
      return chain;
    });
    chain.upsert = vi.fn((row: Record<string, unknown>) => {
      insertCalls.push(row);
      return { then: (r: (v: { error: null }) => void) => r({ error: null }) };
    });
    chain.maybeSingle = vi.fn(async () => ({ data: opts.maybeSingle ?? null, error: null }));
    chain.single = vi.fn(async () => ({ data: { id: opts.insertId ?? "new-id" }, error: null }));
    chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null });
    return chain;
  });
  const rpc = vi.fn((fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    return { then: (r: (v: { error: unknown }) => void) => r({ error: opts.rpcError ?? null }) };
  });
  return { client: { from, rpc } as unknown as SupabaseClient, updateCalls, insertCalls, rpcCalls };
}

const now = new Date("2026-09-08T20:00:00.000Z");

describe("write-registry — work/business dispatch shape", () => {
  it("work has target/task/work_session; business has kill_list_item/weekly_goal", () => {
    expect(listWriteEntities("work").sort()).toEqual(["target", "task", "work_session"]);
    expect(listWriteEntities("business").sort()).toEqual(["kill_list_item", "weekly_goal"]);
  });

  it("work.target has no 'remove' action; work.task has no 'remove'/'bulk_remove' — the no-hard-delete guardrail, at the discovery layer", () => {
    expect(listWriteActions("work", "target")).not.toContain("remove");
    expect(listWriteActions("work", "task")).not.toContain("remove");
    expect(listWriteActions("work", "task")).not.toContain("bulk_remove");
  });

  it("work.task has all four pipeline transitions plus add/edit", () => {
    expect(listWriteActions("work", "task").sort()).toEqual(["add", "advance", "block", "edit", "retreat", "unblock"]);
  });
});

describe("work.target.create", () => {
  it("creates a target (kind:'target') and returns its real id", async () => {
    const action = getWriteAction("work", "target", "create")!;
    const { client, insertCalls } = makeClient({ insertId: "t-9" });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { kind: "target", title: "Ship it", deadline: "2026-09-15" });
    expect(textOf(outcome)).toEqual({ id: "t-9" });
    expect(insertCalls[0]).toMatchObject({ title: "Ship it", deadline: "2026-09-15" });
  });

  it("REJECTS a target with no deadline, via the real addTargetCore guard", async () => {
    const action = getWriteAction("work", "target", "create")!;
    const { client } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { kind: "target", title: "Ship it" })).rejects.toThrow(/deadline/i);
  });

  it("creates a stretch goal (kind:'stretch') with no deadline required", async () => {
    const action = getWriteAction("work", "target", "create")!;
    const { client, insertCalls } = makeClient({ insertId: "t-10" });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { kind: "stretch", title: "Nice to have" });
    expect(textOf(outcome)).toEqual({ id: "t-10" });
    expect(insertCalls[0]).toMatchObject({ deadline: null });
  });

  it("REJECTS an invalid kind", async () => {
    const action = getWriteAction("work", "target", "create")!;
    const { client } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { kind: "goal", title: "x" })).rejects.toThrow(/kind/i);
  });
});

describe("work.target.edit / .complete / .reorder — all require the top-level id", () => {
  it("edit requires ctx.id", async () => {
    const action = getWriteAction("work", "target", "edit")!;
    const { client } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { title: "New" })).rejects.toThrow(/requires the top-level `id`/i);
  });

  it("edit updates the given fields", async () => {
    const action = getWriteAction("work", "target", "edit")!;
    const { client, updateCalls } = makeClient();
    await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "t-1" }, { title: "New title" });
    expect(updateCalls[0]).toEqual({ title: "New title" });
  });

  it("complete calls through to the RPC and reports promotion", async () => {
    const action = getWriteAction("work", "target", "complete")!;
    const { client, rpcCalls } = makeClient({ maybeSingle: { position: 1 } });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "t-1" }, {});
    expect(rpcCalls[0].fn).toBe("complete_target");
    expect(textOf(outcome)).toMatchObject({ id: "t-1" });
  });

  it("reorder requires patch.position", async () => {
    const action = getWriteAction("work", "target", "reorder")!;
    const { client } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "t-1" }, {})).rejects.toThrow(/position/i);
  });

  it("reorder calls reorder_coop_target with the new position — the 'in diff order optionally' proof", async () => {
    const action = getWriteAction("work", "target", "reorder")!;
    const { client, rpcCalls } = makeClient();
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "t-1" }, { position: 3 });
    expect(rpcCalls[0]).toEqual({ fn: "reorder_coop_target", args: { p_target_id: "t-1", p_new_position: 3 } });
    expect(textOf(outcome)).toEqual({ id: "t-1", position: 3 });
  });
});

describe("work.task — add/edit/advance/retreat/block/unblock", () => {
  it("add requires the top-level id (the target's id) and returns the new task's real id", async () => {
    const action = getWriteAction("work", "task", "add")!;
    const { client, insertCalls } = makeClient({ insertId: "task-9" });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "target-1" }, { title: "Write the report" });
    expect(textOf(outcome)).toEqual({ id: "task-9" });
    expect(insertCalls[0]).toMatchObject({ target_id: "target-1", title: "Write the report" });
  });

  it("advance requires patch.current_status and calls through to advanceTaskCore's update shape", async () => {
    const action = getWriteAction("work", "task", "advance")!;
    const { client, updateCalls } = makeClient();
    await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "task-1" }, { current_status: "backlog" });
    expect(updateCalls[0]).toEqual({ status: "in_progress", completed_at: null });
  });

  it("block captures blocked_from — the MCP write tool has no reason input, so blocked_reason stays null", async () => {
    const action = getWriteAction("work", "task", "block")!;
    const { client, updateCalls } = makeClient();
    await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "task-1" }, { current_status: "review" });
    expect(updateCalls[0]).toMatchObject({ status: "blocked", blocked_from: "review", blocked_reason: null, completed_at: null });
    expect(updateCalls[0].blocked_since).toEqual(expect.any(String));
  });

  it("unblock restores the given status", async () => {
    const action = getWriteAction("work", "task", "unblock")!;
    const { client, updateCalls } = makeClient();
    await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "task-1" }, { current_status: "in_progress" });
    expect(updateCalls[0]).toEqual({ status: "in_progress", blocked_from: null, blocked_reason: null, blocked_since: null, completed_at: null });
  });

  it("REJECTS an invalid current_status", async () => {
    const action = getWriteAction("work", "task", "advance")!;
    const { client } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "task-1" }, { current_status: "done" })).rejects.toThrow(/current_status/i);
  });
});

describe("work.work_session — start/end", () => {
  it("start requires a valid kind and returns the new session's id", async () => {
    const action = getWriteAction("work", "work_session", "start")!;
    const { client } = makeClient({ maybeSingle: null, insertId: "session-1" });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { kind: "deep_work" });
    expect(textOf(outcome)).toMatchObject({ id: "session-1" });
  });

  it("start REJECTS an invalid kind", async () => {
    const action = getWriteAction("work", "work_session", "start")!;
    const { client } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { kind: "break" })).rejects.toThrow(/kind/i);
  });

  it("end requires the top-level id and stamps ended_at", async () => {
    const action = getWriteAction("work", "work_session", "end")!;
    const { client, updateCalls } = makeClient({ maybeSingle: { id: "session-1" } });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "session-1" }, {});
    // endWorkSessionCore stamps ended_at with a fresh new Date() at call
    // time (a plain instant, not a derived calendar date -- AGENTS.md's
    // rule is about the latter), so this checks the shape, not an exact
    // value pinned to the test's own `now`.
    expect(updateCalls[0]).toEqual({ ended_at: expect.any(String) });
    expect(textOf(outcome)).toEqual({ id: "session-1" });
  });
});

describe("business.kill_list_item — set/toggle", () => {
  it("set requires date/position/text and scopes position to 0|1|2", async () => {
    const action = getWriteAction("business", "kill_list_item", "set")!;
    const { client, insertCalls } = makeClient();
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", position: 1, text: "Call the vendor" });
    expect(insertCalls[0]).toMatchObject({ date: "2026-09-08", position: 1, text: "Call the vendor" });
    expect(textOf(outcome)).toMatchObject({ date: "2026-09-08", position: 1 });
  });

  it("set REJECTS an out-of-range position", async () => {
    const action = getWriteAction("business", "kill_list_item", "set")!;
    const { client } = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { date: "2026-09-08", position: 3, text: "x" }),
    ).rejects.toThrow(/position/i);
  });

  it("toggle requires the top-level id and flips completion", async () => {
    const action = getWriteAction("business", "kill_list_item", "toggle")!;
    const { client, updateCalls } = makeClient({ maybeSingle: { completed: false } });
    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "item-1" }, {});
    expect(updateCalls[0]).toMatchObject({ completed: true });
    expect(textOf(outcome)).toMatchObject({ id: "item-1", completed: true });
  });

  it("toggle THROWS (not a silent no-op) when the item doesn't exist", async () => {
    const action = getWriteAction("business", "kill_list_item", "toggle")!;
    const { client } = makeClient({ maybeSingle: null });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "item-1" }, {})).rejects.toThrow(/not found/i);
  });
});

describe("business.weekly_goal.save", () => {
  it("requires week_start_date/headline/milestones and upserts scoped to domain:'business'", async () => {
    const action = getWriteAction("business", "weekly_goal", "save")!;
    const { client, insertCalls } = makeClient();
    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now },
      { week_start_date: "2026-09-07", headline: "Close the quarter", milestones: ["m1", "m2"] },
    );
    expect(insertCalls[0]).toMatchObject({ domain: "business", headline: "Close the quarter", milestones: ["m1", "m2"] });
    expect(textOf(outcome)).toMatchObject({ week_start_date: "2026-09-07" });
  });

  it("REJECTS milestones that isn't an array of strings", async () => {
    const action = getWriteAction("business", "weekly_goal", "save")!;
    const { client } = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { week_start_date: "2026-09-07", headline: "x", milestones: [1, 2] }),
    ).rejects.toThrow(/milestones/i);
  });
});
