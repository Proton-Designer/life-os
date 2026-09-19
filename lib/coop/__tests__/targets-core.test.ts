import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addTargetCore, addStretchGoalCore, editTargetCore, completeTargetCore, moveTargetCore, getActiveTargetQueueCore } from "../targets-core";

function makeClient(opts: {
  queue?: unknown[];
  rpcError?: unknown;
  before?: { position: number } | null;
  promoted?: { id: string; deadline: string | null } | null;
  newId?: string;
  /** editTargetCore's UPDATE...SELECT result -- P4-34's requireRowUpdated reads this to decide zero-rows-matched. Defaults to a non-empty row so every pre-existing test here (none of which cares about this) keeps passing unchanged; a test that DOES care passes `[]` to simulate a bad/stale/cross-tenant id. */
  updateResult?: unknown[];
} = {}) {
  const insertCalls: Record<string, unknown>[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  // completeTargetCore makes TWO separate `.from("coop_targets")...maybeSingle()`
  // calls (the pre-RPC "before" position lookup, then the post-RPC "promoted"
  // row lookup) — a call counter is what lets one fake client answer each
  // correctly, since `from()` is invoked fresh each time.
  let maybeSingleCallCount = 0;
  const from = vi.fn((_table: string) => {
    const chain: Record<string, unknown> = {};
    let isUpdate = false;
    for (const m of ["select", "eq", "not"]) chain[m] = vi.fn(() => chain);
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      insertCalls.push(row);
      return chain; // chainable -- addTargetCore/addStretchGoalCore do .insert(...).select("id").single()
    });
    chain.single = vi.fn(async () => ({ data: { id: opts.newId ?? "new-id" }, error: null }));
    chain.update = vi.fn(() => {
      isUpdate = true;
      return chain;
    });
    chain.maybeSingle = vi.fn(async () => {
      maybeSingleCallCount += 1;
      const data = maybeSingleCallCount === 1 ? (opts.before ?? null) : (opts.promoted ?? null);
      return { data, error: null };
    });
    chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
      resolve({ data: isUpdate ? (opts.updateResult ?? [{ id: "row-1" }]) : (opts.queue ?? []), error: null });
    return chain;
  });
  const rpc = vi.fn((fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    return { then: (r: (v: { error: unknown }) => void) => r({ error: opts.rpcError ?? null }) };
  });
  return { client: { from, rpc } as unknown as SupabaseClient, insertCalls, rpcCalls };
}

describe("getActiveTargetQueueCore", () => {
  it("returns [] rather than null when there's nothing active", async () => {
    const { client } = makeClient({ queue: undefined });
    const result = await getActiveTargetQueueCore(client, "user-1");
    expect(result).toEqual([]);
  });
});

describe("addTargetCore", () => {
  it("REJECTS a target with no deadline", async () => {
    const { client, insertCalls } = makeClient({ queue: [] });
    await expect(addTargetCore(client, "user-1", "Ship the thing", "")).rejects.toThrow(/requires a deadline/i);
    expect(insertCalls).toHaveLength(0);
  });

  it("no-ops on a blank/whitespace-only title", async () => {
    const { client, insertCalls } = makeClient({ queue: [] });
    await addTargetCore(client, "user-1", "   ", "2026-09-15");
    expect(insertCalls).toHaveLength(0);
  });

  it("inserts at the next open target slot", async () => {
    const { client, insertCalls } = makeClient({ queue: [{ id: "t1", title: "existing", deadline: "2026-09-10", position: 1 }] });
    await addTargetCore(client, "user-1", "Ship the thing", "2026-09-15");
    expect(insertCalls[0]).toMatchObject({ user_id: "user-1", title: "Ship the thing", deadline: "2026-09-15", position: 2 });
  });
});

describe("addStretchGoalCore", () => {
  it("never requires a deadline — inserts with deadline: null", async () => {
    const { client, insertCalls } = makeClient({ queue: [] });
    await addStretchGoalCore(client, "user-1", "Nice to have");
    expect(insertCalls[0]).toMatchObject({ deadline: null });
  });

  it("no-ops on a blank title", async () => {
    const { client, insertCalls } = makeClient({ queue: [] });
    await addStretchGoalCore(client, "user-1", "");
    expect(insertCalls).toHaveLength(0);
  });
});

describe("editTargetCore", () => {
  it("updates only the fields given", async () => {
    const { client } = makeClient();
    const fromSpy = client.from as unknown as ReturnType<typeof vi.fn>;
    await editTargetCore(client, "user-1", "t1", { title: "New title" });
    const chain = fromSpy.mock.results[0].value;
    expect(chain.update).toHaveBeenCalledWith({ title: "New title" });
  });

  it("no-ops when nothing is given", async () => {
    const { client } = makeClient();
    const fromSpy = client.from as unknown as ReturnType<typeof vi.fn>;
    await editTargetCore(client, "user-1", "t1", {});
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("no-ops on a blank title, even if a deadline is also given", async () => {
    const { client } = makeClient();
    const fromSpy = client.from as unknown as ReturnType<typeof vi.fn>;
    await editTargetCore(client, "user-1", "t1", { title: "   " });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  // P4-34: a plain .update() with no result check reported success for a
  // bad, stale, or cross-tenant id -- the update matched zero rows and
  // nothing told the caller. Both cases below produce the IDENTICAL
  // zero-row result from the same user_id-scoped query (requireRowUpdated's
  // own enumeration-safety property) -- account A editing account B's
  // target id is indistinguishable from account A editing an id that never
  // existed at all, which is exactly what must be true.
  it("throws a clean not-found for a cross-tenant id (account A editing account B's target) instead of reporting success", async () => {
    const { client } = makeClient({ updateResult: [] });
    await expect(editTargetCore(client, "user-1", "belongs-to-account-b", { title: "Renamed" })).rejects.toThrow(
      /No target found with id "belongs-to-account-b"/
    );
  });

  it("throws a clean not-found for the caller's own stale/deleted id -- the common, non-adversarial case", async () => {
    const { client } = makeClient({ updateResult: [] });
    await expect(editTargetCore(client, "user-1", "deleted-earlier", { title: "Renamed" })).rejects.toThrow(
      /No target found with id "deleted-earlier"/
    );
  });
});

describe("completeTargetCore", () => {
  it("calls complete_target and reports no promotion when nothing occupies the vacated slot", async () => {
    const { client, rpcCalls } = makeClient({ before: { position: 1 }, promoted: null });
    const result = await completeTargetCore(client, "user-1", "t1");
    expect(rpcCalls[0]).toEqual({ fn: "complete_target", args: { p_target_id: "t1" } });
    expect(result).toEqual({ promotedTargetId: null, promotedNeedsDeadline: false });
  });

  it("reports the promoted target and whether it needs a deadline", async () => {
    const { client } = makeClient({ before: { position: 1 }, promoted: { id: "t2", deadline: null } });
    const result = await completeTargetCore(client, "user-1", "t1");
    expect(result).toEqual({ promotedTargetId: "t2", promotedNeedsDeadline: true });
  });

  it("a promoted target that already has a deadline reports promotedNeedsDeadline: false", async () => {
    const { client } = makeClient({ before: { position: 1 }, promoted: { id: "t2", deadline: "2026-10-01" } });
    const result = await completeTargetCore(client, "user-1", "t1");
    expect(result.promotedNeedsDeadline).toBe(false);
  });

  it("no promotion when the completed row had already left the active queue", async () => {
    const { client } = makeClient({ before: null });
    const result = await completeTargetCore(client, "user-1", "t1");
    expect(result).toEqual({ promotedTargetId: null, promotedNeedsDeadline: false });
  });
});

describe("moveTargetCore — the 'in diff order optionally' mechanism", () => {
  it("calls reorder_coop_target with the target id and new position", async () => {
    const { client, rpcCalls } = makeClient();
    await moveTargetCore(client, "user-1", "t1", 2);
    expect(rpcCalls[0]).toEqual({ fn: "reorder_coop_target", args: { p_target_id: "t1", p_new_position: 2 } });
  });

  it("surfaces an RPC error as a real throw", async () => {
    const { client } = makeClient({ rpcError: { message: "not found" } });
    await expect(moveTargetCore(client, "user-1", "t1", 2)).rejects.toThrow(/not found/);
  });
});
