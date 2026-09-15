import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getHoursByKindForRange } from "../hours-today";

type Resp = { data: unknown };

function makeClient(response: Resp) {
  const calls: { method: string; args: unknown[] }[] = [];
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "lt"]) {
      chain[method] = vi.fn((...args: unknown[]) => {
        calls.push({ method, args });
        return chain;
      });
    }
    chain.then = (res: (v: Resp) => void) => res(response);
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

const now = new Date("2026-09-14T12:00:00.000Z");
const startIso = "2026-09-07T00:00:00.000Z";
const endIso = "2026-09-14T00:00:00.000Z";

describe("getHoursByKindForRange — #46's Total Hours + by-category", () => {
  it("is NOT counts_toward_hours-filtered, unlike getHoursTodayMinutes -- 'learn' must survive", async () => {
    const { client, calls } = makeClient({
      data: [{ started_at: "2026-09-10T10:00:00Z", ended_at: "2026-09-10T10:30:00Z", kind: "learn" }],
    });
    const result = await getHoursByKindForRange(client, "user-1", startIso, endIso, now);

    expect(calls.some((c) => c.method === "eq" && c.args[0] === "counts_toward_hours")).toBe(false);
    expect(result.byKind.learn).toBeCloseTo(30, 5);
    expect(result.totalMinutes).toBeCloseTo(30, 5);
  });

  it("buckets minutes by kind, and totalMinutes is exactly the sum of every bucket", async () => {
    const { client } = makeClient({
      data: [
        { started_at: "2026-09-08T09:00:00Z", ended_at: "2026-09-08T10:00:00Z", kind: "deep_work" }, // 60
        { started_at: "2026-09-09T09:00:00Z", ended_at: "2026-09-09T09:45:00Z", kind: "deep_work" }, // 45
        { started_at: "2026-09-10T14:00:00Z", ended_at: "2026-09-10T15:30:00Z", kind: "deep_study" }, // 90
        { started_at: "2026-09-11T08:00:00Z", ended_at: "2026-09-11T08:20:00Z", kind: "learn" }, // 20
      ],
    });
    const result = await getHoursByKindForRange(client, "user-1", startIso, endIso, now);

    expect(result.byKind).toEqual({ deep_work: 105, deep_study: 90, learn: 20 });
    expect(result.totalMinutes).toBe(105 + 90 + 20);
  });

  it("treats an unended session as running until `now`, same as getHoursTodayMinutes", async () => {
    const { client } = makeClient({
      data: [{ started_at: "2026-09-14T11:00:00Z", ended_at: null, kind: "deep_work" }],
    });
    const result = await getHoursByKindForRange(client, "user-1", startIso, endIso, now); // now = 12:00Z
    expect(result.byKind.deep_work).toBeCloseTo(60, 5);
  });

  it("scopes the query to the given user and [startIso, endIso) range", async () => {
    const { client, calls } = makeClient({ data: [] });
    await getHoursByKindForRange(client, "user-1", startIso, endIso, now);
    const eqArgs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["user_id", "user-1"]);
    const gteArgs = calls.filter((c) => c.method === "gte").map((c) => c.args);
    expect(gteArgs).toContainEqual(["started_at", startIso]);
    const ltArgs = calls.filter((c) => c.method === "lt").map((c) => c.args);
    expect(ltArgs).toContainEqual(["started_at", endIso]);
  });

  it("returns zero totals for an empty range without erroring", async () => {
    const { client } = makeClient({ data: [] });
    const result = await getHoursByKindForRange(client, "user-1", startIso, endIso, now);
    expect(result).toEqual({ totalMinutes: 0, byKind: {} });
  });
});
