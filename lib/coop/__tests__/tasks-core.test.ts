import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addAgendaTaskCore, editTaskCore, returnTaskToReviewCore, advanceTaskCore, retreatTaskCore, blockTaskCore, unblockTaskCore } from "../tasks-core";

function makeClient() {
  const insertCalls: Record<string, unknown>[] = [];
  const updateCalls: Record<string, unknown>[] = [];
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn(() => chain);
    chain.select = vi.fn(() => chain);
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      insertCalls.push(row);
      return chain; // chainable -- addAgendaTaskCore does .insert(...).select("id").single()
    });
    chain.single = vi.fn(async () => ({ data: { id: "new-id" }, error: null }));
    chain.update = vi.fn((row: Record<string, unknown>) => {
      updateCalls.push(row);
      return chain;
    });
    chain.then = (resolve: (v: { error: null }) => void) => resolve({ error: null });
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, insertCalls, updateCalls };
}

describe("addAgendaTaskCore", () => {
  it("inserts with status: backlog", async () => {
    const { client, insertCalls } = makeClient();
    await addAgendaTaskCore(client, "target-1", "Write the report", "2026-09-15");
    expect(insertCalls[0]).toEqual({ target_id: "target-1", title: "Write the report", deadline: "2026-09-15", status: "backlog" });
  });

  it("no-ops on a blank title", async () => {
    const { client, insertCalls } = makeClient();
    await addAgendaTaskCore(client, "target-1", "   ");
    expect(insertCalls).toHaveLength(0);
  });
});

describe("editTaskCore", () => {
  it("updates only the given fields", async () => {
    const { client, updateCalls } = makeClient();
    await editTaskCore(client, "user-1", "task-1", { title: "Renamed" });
    expect(updateCalls[0]).toEqual({ title: "Renamed" });
  });

  it("no-ops when nothing is given", async () => {
    const { client, updateCalls } = makeClient();
    await editTaskCore(client, "user-1", "task-1", {});
    expect(updateCalls).toHaveLength(0);
  });
});

describe("status transitions — advance/retreat/block/unblock, all sharing the completed_at-stamping rule", () => {
  it("advanceTaskCore moves backlog -> in_progress, no completed_at", async () => {
    const { client, updateCalls } = makeClient();
    await advanceTaskCore(client, "user-1", "task-1", "backlog");
    expect(updateCalls[0]).toEqual({ status: "in_progress", completed_at: null });
  });

  it("advanceTaskCore landing on complete stamps completed_at", async () => {
    const { client, updateCalls } = makeClient();
    await advanceTaskCore(client, "user-1", "task-1", "review");
    expect(updateCalls[0]).toMatchObject({ status: "complete" });
    expect(updateCalls[0].completed_at).toEqual(expect.any(String));
  });

  it("advanceTaskCore is a no-op past complete — nothing further to advance to", async () => {
    const { client, updateCalls } = makeClient();
    await advanceTaskCore(client, "user-1", "task-1", "complete");
    expect(updateCalls).toHaveLength(0);
  });

  it("retreatTaskCore moves in_progress -> backlog", async () => {
    const { client, updateCalls } = makeClient();
    await retreatTaskCore(client, "user-1", "task-1", "in_progress");
    expect(updateCalls[0]).toEqual({ status: "backlog", completed_at: null });
  });

  it("retreatTaskCore is a no-op before backlog — nothing further to retreat to", async () => {
    const { client, updateCalls } = makeClient();
    await retreatTaskCore(client, "user-1", "task-1", "backlog");
    expect(updateCalls).toHaveLength(0);
  });

  it("blockTaskCore captures blocked_from, clears completed_at, and stamps blocked_since", async () => {
    const { client, updateCalls } = makeClient();
    await blockTaskCore(client, "user-1", "task-1", "in_progress");
    expect(updateCalls[0]).toMatchObject({ status: "blocked", blocked_from: "in_progress", completed_at: null, blocked_reason: null });
    expect(updateCalls[0].blocked_since).toEqual(expect.any(String));
  });

  it("blockTaskCore stores a trimmed reason", async () => {
    const { client, updateCalls } = makeClient();
    await blockTaskCore(client, "user-1", "task-1", "in_progress", "  waiting on legal  ");
    expect(updateCalls[0]).toMatchObject({ blocked_reason: "waiting on legal" });
  });

  it("blockTaskCore stores null (not an empty string) when the reason is blank or omitted", async () => {
    const { client, updateCalls } = makeClient();
    await blockTaskCore(client, "user-1", "task-1", "in_progress", "   ");
    expect(updateCalls[0]).toMatchObject({ blocked_reason: null });

    const { client: client2, updateCalls: updateCalls2 } = makeClient();
    await blockTaskCore(client2, "user-1", "task-1", "in_progress");
    expect(updateCalls2[0]).toMatchObject({ blocked_reason: null });
  });

  it("unblockTaskCore restores the prior status and clears blocked_from, blocked_reason, and blocked_since", async () => {
    const { client, updateCalls } = makeClient();
    await unblockTaskCore(client, "user-1", "task-1", "review");
    expect(updateCalls[0]).toEqual({ status: "review", blocked_from: null, blocked_reason: null, blocked_since: null, completed_at: null });
  });

  it("unblockTaskCore landing back on complete restarts the completed_at clock", async () => {
    const { client, updateCalls } = makeClient();
    await unblockTaskCore(client, "user-1", "task-1", "complete");
    expect(updateCalls[0]).toMatchObject({ status: "complete", blocked_from: null, blocked_reason: null, blocked_since: null });
    expect(updateCalls[0].completed_at).toEqual(expect.any(String));
  });

  it("returnTaskToReviewCore sets status to review", async () => {
    const { client, updateCalls } = makeClient();
    await returnTaskToReviewCore(client, "user-1", "task-1");
    expect(updateCalls[0]).toEqual({ status: "review", completed_at: null });
  });
});
