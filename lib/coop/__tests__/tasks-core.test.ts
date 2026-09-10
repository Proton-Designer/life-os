import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addAgendaTaskCore, editTaskCore, returnTaskToReviewCore, advanceTaskCore, retreatTaskCore, blockTaskCore, unblockTaskCore } from "../tasks-core";

/**
 * `currentRow` seeds what `setStatusCore`/`blockTaskCore`/`unblockTaskCore`'s
 * own pre-write SELECT returns (the row's state BEFORE this call) — added
 * alongside the idempotency fix (block/advance/unblock now read current
 * state before deciding whether to stamp a fresh timestamp or preserve the
 * existing one). Tests that exercise a transition INTO "complete"/"blocked"
 * for the first time pass a `currentRow` that is NOT already there yet;
 * retry tests (below, using `makeStatefulClient`) prove the preserving side.
 */
function makeClient(currentRow: Record<string, unknown> | null = null) {
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
    chain.maybeSingle = vi.fn(async () => ({ data: currentRow, error: null }));
    chain.update = vi.fn((row: Record<string, unknown>) => {
      updateCalls.push(row);
      return chain;
    });
    chain.then = (resolve: (v: { error: null }) => void) => resolve({ error: null });
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, insertCalls, updateCalls };
}

/**
 * A genuinely STATEFUL fake: unlike `makeClient` above (which returns one
 * fixed `currentRow` no matter how many times it's queried), this one keeps
 * a real row in memory and lets each call's SELECT see whatever the
 * PREVIOUS call's UPDATE actually wrote. That's the only way to prove a
 * retry preserves a timestamp instead of re-stamping it -- a static mock
 * would just report whatever it was told to regardless of the fix.
 */
function makeStatefulClient(initialRow: Record<string, unknown>) {
  let row: Record<string, unknown> | null = { ...initialRow };
  const from = vi.fn(() => {
    let patch: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => ({ data: row ? { ...row } : null, error: null }));
    chain.update = vi.fn((p: Record<string, unknown>) => {
      patch = { ...p };
      return chain;
    });
    chain.then = (resolve: (v: { error: null }) => void) => {
      if (patch && row) row = { ...row, ...patch };
      return resolve({ error: null });
    };
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, getRow: () => row };
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
    const { client, updateCalls } = makeClient({ status: "backlog", completed_at: null });
    await advanceTaskCore(client, "user-1", "task-1", "backlog");
    expect(updateCalls[0]).toEqual({ status: "in_progress", completed_at: null });
  });

  it("advanceTaskCore landing on complete for the first time stamps a fresh completed_at", async () => {
    const { client, updateCalls } = makeClient({ status: "review", completed_at: null });
    await advanceTaskCore(client, "user-1", "task-1", "review");
    expect(updateCalls[0]).toMatchObject({ status: "complete" });
    expect(updateCalls[0].completed_at).toEqual(expect.any(String));
  });

  it("advanceTaskCore is a no-op past complete — nothing further to advance to", async () => {
    const { client, updateCalls } = makeClient({ status: "complete", completed_at: "2026-09-01T00:00:00.000Z" });
    await advanceTaskCore(client, "user-1", "task-1", "complete");
    expect(updateCalls).toHaveLength(0);
  });

  it("retreatTaskCore moves in_progress -> backlog", async () => {
    const { client, updateCalls } = makeClient({ status: "in_progress", completed_at: null });
    await retreatTaskCore(client, "user-1", "task-1", "in_progress");
    expect(updateCalls[0]).toEqual({ status: "backlog", completed_at: null });
  });

  it("retreatTaskCore is a no-op before backlog — nothing further to retreat to", async () => {
    const { client, updateCalls } = makeClient({ status: "backlog", completed_at: null });
    await retreatTaskCore(client, "user-1", "task-1", "backlog");
    expect(updateCalls).toHaveLength(0);
  });

  it("blockTaskCore captures blocked_from, clears completed_at, and stamps a fresh blocked_since on a genuine (non-retry) block", async () => {
    const { client, updateCalls } = makeClient({ status: "in_progress", blocked_since: null });
    await blockTaskCore(client, "user-1", "task-1", "in_progress");
    expect(updateCalls[0]).toMatchObject({ status: "blocked", blocked_from: "in_progress", completed_at: null, blocked_reason: null });
    expect(updateCalls[0].blocked_since).toEqual(expect.any(String));
  });

  it("blockTaskCore stores a trimmed reason", async () => {
    const { client, updateCalls } = makeClient({ status: "in_progress", blocked_since: null });
    await blockTaskCore(client, "user-1", "task-1", "in_progress", "  waiting on legal  ");
    expect(updateCalls[0]).toMatchObject({ blocked_reason: "waiting on legal" });
  });

  it("blockTaskCore stores null (not an empty string) when the reason is blank or omitted", async () => {
    const { client, updateCalls } = makeClient({ status: "in_progress", blocked_since: null });
    await blockTaskCore(client, "user-1", "task-1", "in_progress", "   ");
    expect(updateCalls[0]).toMatchObject({ blocked_reason: null });

    const { client: client2, updateCalls: updateCalls2 } = makeClient({ status: "in_progress", blocked_since: null });
    await blockTaskCore(client2, "user-1", "task-1", "in_progress");
    expect(updateCalls2[0]).toMatchObject({ blocked_reason: null });
  });

  it("unblockTaskCore restores the prior status and clears blocked_from, blocked_reason, and blocked_since", async () => {
    const { client, updateCalls } = makeClient({ status: "blocked", completed_at: null });
    await unblockTaskCore(client, "user-1", "task-1", "review");
    expect(updateCalls[0]).toEqual({ status: "review", blocked_from: null, blocked_reason: null, blocked_since: null, completed_at: null });
  });

  it("unblockTaskCore restoring to complete for the first time stamps a fresh completed_at (genuine transition, not a retry)", async () => {
    const { client, updateCalls } = makeClient({ status: "blocked", completed_at: null });
    await unblockTaskCore(client, "user-1", "task-1", "complete");
    expect(updateCalls[0]).toMatchObject({ status: "complete", blocked_from: null, blocked_reason: null, blocked_since: null });
    expect(updateCalls[0].completed_at).toEqual(expect.any(String));
  });

  it("returnTaskToReviewCore sets status to review", async () => {
    const { client, updateCalls } = makeClient({ status: "complete", completed_at: "2026-09-01T00:00:00.000Z" });
    await returnTaskToReviewCore(client, "user-1", "task-1");
    expect(updateCalls[0]).toEqual({ status: "review", completed_at: null });
  });
});

describe("idempotency — retrying block/advance/unblock must preserve the timestamp, not re-stamp it (team-lead's brief: seed a row, call twice, real time between the calls, assert byte-identical)", () => {
  it("blockTaskCore: a retry against an already-blocked row preserves the original blocked_since", async () => {
    const { client, getRow } = makeStatefulClient({ status: "in_progress", blocked_from: null, blocked_reason: null, blocked_since: null, completed_at: null });

    await blockTaskCore(client, "user-1", "task-1", "in_progress");
    const firstBlockedSince = getRow()!.blocked_since as string;
    expect(firstBlockedSince).toEqual(expect.any(String));

    await new Promise((resolve) => setTimeout(resolve, 15)); // genuinely separate instants, not a frozen `now()`

    // Retry: caller still believes the prior status was "in_progress" (it
    // doesn't know the first call already landed), which is exactly the
    // at-least-once-delivery shape the scheduler produces.
    await blockTaskCore(client, "user-1", "task-1", "in_progress");
    const secondBlockedSince = getRow()!.blocked_since as string;

    expect(secondBlockedSince).toBe(firstBlockedSince);
  });

  it("advanceTaskCore: a retry that lands on the already-current complete status preserves the original completed_at", async () => {
    const { client, getRow } = makeStatefulClient({ status: "review", completed_at: null });

    await advanceTaskCore(client, "user-1", "task-1", "review");
    const firstCompletedAt = getRow()!.completed_at as string;
    expect(firstCompletedAt).toEqual(expect.any(String));

    await new Promise((resolve) => setTimeout(resolve, 15));

    // Retry: caller-supplied currentStatus is stale ("review"), same as the
    // first call -- nextStage("review") computes "complete" again.
    await advanceTaskCore(client, "user-1", "task-1", "review");
    const secondCompletedAt = getRow()!.completed_at as string;

    expect(secondCompletedAt).toBe(firstCompletedAt);
  });

  it("unblockTaskCore: a retry that lands on the already-restored complete status preserves the original completed_at", async () => {
    const { client, getRow } = makeStatefulClient({ status: "blocked", blocked_from: "complete", blocked_reason: null, blocked_since: "2026-09-01T00:00:00.000Z", completed_at: null });

    await unblockTaskCore(client, "user-1", "task-1", "complete");
    const firstCompletedAt = getRow()!.completed_at as string;
    expect(firstCompletedAt).toEqual(expect.any(String));

    await new Promise((resolve) => setTimeout(resolve, 15));

    // Retry: same call again (blockedFrom="complete"), row is now already
    // "complete" from the first call.
    await unblockTaskCore(client, "user-1", "task-1", "complete");
    const secondCompletedAt = getRow()!.completed_at as string;

    expect(secondCompletedAt).toBe(firstCompletedAt);
  });
});
