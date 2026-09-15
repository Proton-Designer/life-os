import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processHourCompletions } from "../hour-completion";
import * as sendPushModule from "@/lib/notifications/send-push";

type CandidateRow = { id: string; user_id: string; kind: string };

/**
 * Fake client covering both calls this module makes per candidate row:
 * the initial `select` (resolves via the thenable) and, per row, an
 * `update(...).eq(...).is(...).select(...)` chain (also thenable at the
 * end). `updateCalls` records every update payload for assertions.
 */
function makeClient(candidates: CandidateRow[], opts: { updateReturnsZeroRows?: boolean } = {}) {
  const selectCalls: { method: string; args: unknown[] }[] = [];
  const updateCalls: { id: string; payload: unknown }[] = [];
  let updateShouldFail = false;

  const from = vi.fn(() => {
    let mode: "select" | "update" = "select";
    let pendingId: string | undefined;
    let pendingPayload: unknown;
    const chain: Record<string, unknown> = {};

    chain.select = vi.fn((...args: unknown[]) => {
      if (mode === "select") selectCalls.push({ method: "select", args });
      return chain;
    });
    chain.eq = vi.fn((...args: unknown[]) => {
      if (mode === "select") selectCalls.push({ method: "eq", args });
      if (args[0] === "id") {
        pendingId = args[1] as string;
        if (mode === "update") updateCalls.push({ id: pendingId, payload: pendingPayload });
      }
      return chain;
    });
    chain.is = vi.fn((...args: unknown[]) => {
      if (mode === "select") selectCalls.push({ method: "is", args });
      return chain;
    });
    chain.lte = vi.fn((...args: unknown[]) => {
      selectCalls.push({ method: "lte", args });
      return chain;
    });
    chain.update = vi.fn((payload: unknown) => {
      mode = "update";
      pendingPayload = payload;
      return chain;
    });
    chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
      if (mode === "select") {
        resolve({ data: candidates, error: null });
      } else {
        if (updateShouldFail) {
          resolve({ data: null, error: { message: "update failed" } });
        } else if (opts.updateReturnsZeroRows) {
          resolve({ data: [], error: null }); // conditional update matched nothing -- lost the race
        } else {
          resolve({ data: [{ id: pendingId }], error: null });
        }
      }
    };
    return chain;
  });

  return {
    client: { from } as unknown as SupabaseClient,
    selectCalls,
    updateCalls,
    failNextUpdate: () => {
      updateShouldFail = true;
    },
  };
}

describe("processHourCompletions (Phase 2 #P2-04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("scopes the select on counts_toward_hours, active-only, not-yet-notified, and a 60-minute-old cutoff", async () => {
    const { client, selectCalls } = makeClient([]);
    await processHourCompletions(client);
    expect(selectCalls.some((c) => c.method === "eq" && c.args[0] === "counts_toward_hours" && c.args[1] === true)).toBe(true);
    expect(selectCalls.some((c) => c.method === "is" && c.args[0] === "ended_at" && c.args[1] === null)).toBe(true);
    expect(selectCalls.some((c) => c.method === "is" && c.args[0] === "hour_notified_at" && c.args[1] === null)).toBe(true);
    expect(selectCalls.some((c) => c.method === "lte" && c.args[0] === "started_at")).toBe(true);
  });

  it("no candidates -- reports zero without calling sendPushToUser", async () => {
    const pushSpy = vi.spyOn(sendPushModule, "sendPushToUser");
    const { client } = makeClient([]);
    const result = await processHourCompletions(client);
    expect(result).toEqual({ candidates: 0, notified: 0 });
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("sends a push per candidate and marks hour_notified_at, once each", async () => {
    const pushSpy = vi.spyOn(sendPushModule, "sendPushToUser").mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client, updateCalls } = makeClient([
      { id: "sess-1", user_id: "user-a", kind: "deep_work" },
      { id: "sess-2", user_id: "user-b", kind: "deep_study" },
    ]);
    const result = await processHourCompletions(client);
    expect(result).toEqual({ candidates: 2, notified: 2 });
    expect(pushSpy).toHaveBeenCalledTimes(2);
    expect(pushSpy).toHaveBeenCalledWith(client, "user-a", "Hour complete", expect.stringContaining("deep work"), "/business");
    expect(pushSpy).toHaveBeenCalledWith(client, "user-b", "Hour complete", expect.stringContaining("deep study"), "/business");
    expect(updateCalls.map((c) => c.id).sort()).toEqual(["sess-1", "sess-2"]);
    for (const call of updateCalls) {
      expect(call.payload).toHaveProperty("hour_notified_at");
    }
  });

  it("falls back to a generic label for a kind not in KIND_LABEL (e.g. exam_prep) rather than throwing", async () => {
    const pushSpy = vi
      .spyOn(sendPushModule, "sendPushToUser")
      .mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient([{ id: "sess-3", user_id: "user-c", kind: "exam_prep" }]);
    await processHourCompletions(client);
    expect(pushSpy).toHaveBeenCalledWith(client, "user-c", "Hour complete", expect.stringContaining("focus"), "/business");
  });

  it("a genuine send failure (thrown, not 'no devices') leaves the row unmarked for retry on the next poll", async () => {
    vi.spyOn(sendPushModule, "sendPushToUser").mockRejectedValueOnce(new Error("VAPID secrets missing"));
    const { client, updateCalls } = makeClient([{ id: "sess-4", user_id: "user-d", kind: "deep_work" }]);
    const result = await processHourCompletions(client);
    expect(result).toEqual({ candidates: 1, notified: 0 });
    expect(updateCalls).toHaveLength(0);
  });

  it("'no devices' (hadSubscriptions:false) does not throw and still records the attempt -- no useful retry once there's truly no device", async () => {
    vi.spyOn(sendPushModule, "sendPushToUser").mockResolvedValue({ hadSubscriptions: false, delivered: 0, total: 0 });
    const { client, updateCalls } = makeClient([{ id: "sess-5", user_id: "user-e", kind: "deep_work" }]);
    const result = await processHourCompletions(client);
    expect(result).toEqual({ candidates: 1, notified: 1 });
    expect(updateCalls).toHaveLength(1);
  });

  it("a lost race on the record step (conditional update matches zero rows, as it would if an overlapping run already claimed it) does not inflate the notified count", async () => {
    vi.spyOn(sendPushModule, "sendPushToUser").mockResolvedValue({ hadSubscriptions: true, delivered: 1, total: 1 });
    const { client } = makeClient([{ id: "sess-6", user_id: "user-f", kind: "deep_work" }], { updateReturnsZeroRows: true });
    const result = await processHourCompletions(client);
    expect(result).toEqual({ candidates: 1, notified: 0 });
  });
});
