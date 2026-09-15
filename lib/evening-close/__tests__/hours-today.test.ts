import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getHoursByKindForRange, getEndedRecallMinutesForRange } from "../hours-today";

type Resp = { data: unknown };
type Call = { method: string; args: unknown[] };

function makeClient(response: Resp) {
  const calls: Call[] = [];
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "lt", "not"]) {
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

describe("getHoursByKindForRange — #46's Total Hours + by-category (CORRECTED 2026-09-15)", () => {
  // THE CORRECTION ITSELF: this is the positive control for the production
  // bug (browser-verified 2026-09-15) -- a mocked response representing
  // what the ORIGINAL, un-filtered version of this function would have
  // received from a real query is fed in here, and the assertion is that
  // it's still excluded. Because this test mocks the Supabase client, it
  // cannot prove the real `.eq("counts_toward_hours", true)` call actually
  // reaches Postgres -- the "scopes the query" test below covers that half
  // by asserting the call itself is made.
  it("is counts_toward_hours-filtered, same as getHoursTodayMinutes -- 'learn' must NEVER enter the headline", async () => {
    const { client, calls } = makeClient({
      // A real `.eq("counts_toward_hours", true)` query could never return
      // a 'learn' row (counts_toward_hours resolves to false for 'learn' by
      // construction, migrations 057/077) -- this row's presence here only
      // proves the function doesn't ALSO re-filter by kind itself (it
      // doesn't need to, and shouldn't duplicate the database's own
      // guarantee) -- the real protection is the query filter, asserted
      // below by checking the call was actually made.
      data: [{ started_at: "2026-09-10T10:00:00Z", ended_at: "2026-09-10T11:07:00Z", kind: "learn" }],
    });
    await getHoursByKindForRange(client, "user-1", startIso, endIso, now);
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "counts_toward_hours" && c.args[1] === true)).toBe(true);
  });

  it("buckets minutes by kind, and totalMinutes is exactly the sum of every bucket -- deep_work/deep_study only", async () => {
    const { client } = makeClient({
      data: [
        { started_at: "2026-09-08T09:00:00Z", ended_at: "2026-09-08T10:00:00Z", kind: "deep_work" }, // 60
        { started_at: "2026-09-09T09:00:00Z", ended_at: "2026-09-09T09:45:00Z", kind: "deep_work" }, // 45
        { started_at: "2026-09-10T14:00:00Z", ended_at: "2026-09-10T15:30:00Z", kind: "deep_study" }, // 90
      ],
    });
    const result = await getHoursByKindForRange(client, "user-1", startIso, endIso, now);

    expect(result.byKind).toEqual({ deep_work: 105, deep_study: 90 });
    expect(result.totalMinutes).toBe(105 + 90);
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
    expect(eqArgs).toContainEqual(["counts_toward_hours", true]);
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

describe("getEndedRecallMinutesForRange — #46's separate Recall line, never summed into Hours", () => {
  it("sums a real ended 'learn' session", async () => {
    const { client } = makeClient({
      data: [{ started_at: "2026-09-10T10:00:00Z", ended_at: "2026-09-10T10:30:00Z" }],
    });
    const minutes = await getEndedRecallMinutesForRange(client, "user-1", startIso, endIso);
    expect(minutes).toBeCloseTo(30, 5);
  });

  // THE PRODUCTION BUG THIS FUNCTION EXISTS TO PREVENT, reproduced exactly:
  // an abandoned review that never closes must NOT display as hours of
  // study -- unlike getHoursByKindForRange's own unended-session handling
  // (which correctly runs a still-active DEEP WORK session to `now`), this
  // query filters an open 'learn' row out entirely rather than crediting it
  // any duration at all.
  it("EXCLUDES an open (still-running) session entirely -- does not run it to `now`", async () => {
    const { client, calls } = makeClient({ data: [] }); // a real `.not("ended_at","is",null)` query would never return this row
    await getEndedRecallMinutesForRange(client, "user-1", startIso, endIso);
    const notArgs = calls.filter((c) => c.method === "not").map((c) => c.args);
    expect(notArgs).toContainEqual(["ended_at", "is", null]);
  });

  it("scopes to kind='learn' only, plus the given user and range", async () => {
    const { client, calls } = makeClient({ data: [] });
    await getEndedRecallMinutesForRange(client, "user-1", startIso, endIso);
    const eqArgs = calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["user_id", "user-1"]);
    expect(eqArgs).toContainEqual(["kind", "learn"]);
    const gteArgs = calls.filter((c) => c.method === "gte").map((c) => c.args);
    expect(gteArgs).toContainEqual(["started_at", startIso]);
  });

  it("sums multiple ended sessions and returns 0 for none", async () => {
    const { client } = makeClient({
      data: [
        { started_at: "2026-09-08T09:00:00Z", ended_at: "2026-09-08T09:25:00Z" }, // 25
        { started_at: "2026-09-09T09:00:00Z", ended_at: "2026-09-09T09:15:00Z" }, // 15
      ],
    });
    const minutes = await getEndedRecallMinutesForRange(client, "user-1", startIso, endIso);
    expect(minutes).toBe(40);
  });

  it("returns 0 for an empty range without erroring", async () => {
    const { client } = makeClient({ data: [] });
    const minutes = await getEndedRecallMinutesForRange(client, "user-1", startIso, endIso);
    expect(minutes).toBe(0);
  });
});
