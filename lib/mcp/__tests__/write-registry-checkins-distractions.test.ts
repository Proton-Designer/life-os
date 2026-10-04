import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction, listWriteEntities, listWriteActions } from "../write-registry";

function textOf(outcome: Awaited<ReturnType<NonNullable<ReturnType<typeof getWriteAction>>["handler"]>>) {
  const block = outcome.result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return JSON.parse(block.text);
}

const now = new Date("2026-09-08T20:00:00.000Z");

describe("write-registry — checkins/distractions dispatch shape", () => {
  it("checkins has exactly one writable entity: allocation", () => {
    expect(listWriteEntities("checkins")).toEqual(["allocation"]);
  });

  it("checkins.allocation has exactly 'save' — the plain point-sample checkin entity is deliberately not writable here", () => {
    expect(listWriteActions("checkins", "allocation")).toEqual(["save"]);
    expect(listWriteActions("checkins", "checkin")).toEqual([]);
  });

  it("distractions has exactly trigger/event/action_plan/plan_outcome", () => {
    expect(listWriteEntities("distractions").sort()).toEqual(["action_plan", "event", "plan_outcome", "trigger"]);
  });

  it("each distractions entity has exactly its one natural action", () => {
    expect(listWriteActions("distractions", "trigger")).toEqual(["capture"]);
    expect(listWriteActions("distractions", "event")).toEqual(["log"]);
    expect(listWriteActions("distractions", "action_plan")).toEqual(["save"]);
    expect(listWriteActions("distractions", "plan_outcome")).toEqual(["record"]);
  });
});

describe("checkins.allocation.save — dispatch", () => {
  it("rejects a missing/malformed patch.allocations before ever touching Supabase", async () => {
    const action = getWriteAction("checkins", "allocation", "save")!;
    const client = { from: vi.fn(), rpc: vi.fn() } as unknown as SupabaseClient;
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, {})).rejects.toThrow(/patch\.allocations is required/i);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects an array for patch.allocations (typeof array === 'object', the same trap registerOAuthClient hit)", async () => {
    const action = getWriteAction("checkins", "allocation", "save")!;
    const client = { from: vi.fn(), rpc: vi.fn() } as unknown as SupabaseClient;
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { allocations: ["deen"] })).rejects.toThrow(/must be an object/i);
  });
});

describe("distractions.trigger.capture — dispatch shape", () => {
  it("returns id/updated_at at the top of structuredContent, matching every other write action's contract", async () => {
    const action = getWriteAction("distractions", "trigger", "capture")!;
    let call = 0;
    const client = {
      from: vi.fn((table: string) => {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.insert = vi.fn(() => chain);
        // captureCore on the "deen" domain reads profiles.deen_mode first (DEEN-06 gate) -- ON here.
        chain.maybeSingle = vi.fn(async () => (table === "profiles" ? { data: { deen_mode: true }, error: null } : { data: null, error: null }));
        chain.single = vi.fn(async () => ({ data: { id: call++ === 0 ? "trig-1" : "event-1" }, error: null }));
        return chain;
      }),
    } as unknown as SupabaseClient;

    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "America/Chicago", now },
      { domain: "deen", name: "phone during dhikr" },
    );

    const body = textOf(outcome);
    expect(body).toMatchObject({ triggerId: "trig-1", eventId: "event-1" });
    const structured = outcome.result.structuredContent as Record<string, unknown>;
    expect(structured.id).toBe("trig-1");
    expect(structured.updated_at).toBe(now.toISOString());
    expect(outcome.summary).toMatch(/captured distraction against trigger trig-1/);
  });
});
