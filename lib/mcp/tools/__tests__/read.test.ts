import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readTool, resolveReadOperation } from "../read";

const ROW = {
  id: "p1",
  date: "2026-09-08",
  prayer_name: "fajr",
  status: "on_time",
  logged_at: "2026-09-08T11:00:00Z",
  user_id: "user-1",
};

function makeClient(opts: { single?: unknown; list?: unknown[]; count?: number; error?: unknown } = {}) {
  const eqCalls: [string, unknown][] = [];
  const isCalls: [string, null][] = [];
  const orderCalls: [string, boolean][] = [];
  let lastRange: [number, number] | null = null;

  const from = vi.fn((_table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return chain;
    });
    // .is(col, null) is the operator applyFixedFilter (read.ts) uses for an
    // explicit `{ is: null }` FixedFilterValue -- tracked SEPARATELY from
    // eqCalls so a test can assert the right operator was used, not just
    // that SOME call happened. `.eq(col, null)` would be a real bug here
    // (PostgREST reads it as `col = NULL`, always false, not IS NULL).
    chain.is = vi.fn((col: string, val: null) => {
      isCalls.push([col, val]);
      return chain;
    });
    chain.order = vi.fn((col: string, o: { ascending: boolean }) => {
      orderCalls.push([col, o.ascending]);
      return chain;
    });
    chain.maybeSingle = vi.fn(async () => ({ data: opts.single ?? null, error: opts.error ?? null }));
    chain.range = vi.fn(async (start: number, end: number) => {
      lastRange = [start, end];
      return { data: opts.list ?? [], error: opts.error ?? null, count: opts.count ?? (opts.list ?? []).length };
    });
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, eqCalls, isCalls, orderCalls, getLastRange: () => lastRange };
}


// Deen Mode gate (lib/mcp/deen-gate.ts) is covered by its own test file; these
// suites exercise the tools' behaviour for an account with Deen Mode ON, and
// their fake clients have no profiles table.
vi.mock("@/lib/mcp/deen-gate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp/deen-gate")>()),
  assertDeenAvailable: async () => {},
  readDeenMode: async () => true,
  deenReadRestriction: async () => null,
}));

describe("resolveReadOperation", () => {
  it("is domain.entity.read", () => {
    expect(resolveReadOperation({ domain: "deen", entity: "prayer" })).toBe("deen.prayer.read");
  });
});

describe("readTool — unknown domain/entity", () => {
  it("REJECTS an unknown domain, naming the valid set", async () => {
    const { client } = makeClient();
    await expect(readTool(client, "user-1", { domain: "nonexistent_domain", entity: "x" })).rejects.toThrow(/unknown domain.*nonexistent_domain/i);
  });

  it("REJECTS an unknown entity for a known domain, naming the valid entities", async () => {
    const { client } = makeClient();
    await expect(readTool(client, "user-1", { domain: "deen", entity: "fasting" })).rejects.toThrow(/unknown entity.*fasting/i);
    await expect(readTool(client, "user-1", { domain: "deen", entity: "fasting" })).rejects.toThrow(/prayer/);
  });
});

describe("readTool — single id lookup", () => {
  it("returns one item, scoped to this user_id in addition to RLS (belt-and-suspenders)", async () => {
    const { client, eqCalls } = makeClient({ single: ROW });
    const outcome = await readTool(client, "user-1", { domain: "deen", entity: "prayer", id: "p1" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const item = JSON.parse(block.text);

    expect(item).toMatchObject({ id: "p1", updated_at: "2026-09-08T11:00:00Z", date: "2026-09-08", prayer_name: "fajr", status: "on_time" });
    expect(eqCalls).toContainEqual(["id", "p1"]);
    expect(eqCalls).toContainEqual(["user_id", "user-1"]);
  });

  it("THROWS a clear 'not found' rather than returning null/empty for a missing id", async () => {
    const { client } = makeClient({ single: null });
    await expect(readTool(client, "user-1", { domain: "deen", entity: "prayer", id: "nope" })).rejects.toThrow(/no prayer found/i);
  });

  it("surfaces a DB error as a real throw", async () => {
    const { client } = makeClient({ error: { message: "db exploded" } });
    await expect(readTool(client, "user-1", { domain: "deen", entity: "prayer", id: "p1" })).rejects.toThrow(/db exploded/);
  });
});

describe("readTool — detail tiers", () => {
  it("detail:'ids' (or default omission at list-level) returns ONLY {id, updated_at} per row — the cheapest possible scan", async () => {
    const { client } = makeClient({ list: [ROW] });
    const outcome = await readTool(client, "user-1", { domain: "deen", entity: "prayer", detail: "ids" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const { items } = JSON.parse(block.text);
    expect(items).toEqual([{ id: "p1", updated_at: "2026-09-08T11:00:00Z" }]);
  });

  it("detail:'summary' (the default) returns the summary columns plus id/updated_at, nothing more", async () => {
    const { client } = makeClient({ list: [ROW] });
    const outcome = await readTool(client, "user-1", { domain: "deen", entity: "prayer" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const { items } = JSON.parse(block.text);
    expect(items[0]).toEqual({ id: "p1", updated_at: "2026-09-08T11:00:00Z", date: "2026-09-08", prayer_name: "fajr", status: "on_time" });
    expect(items[0]).not.toHaveProperty("user_id");
  });

  it("detail:'full' includes every registered column -- and never user_id (P4-04: every row is already the caller's own)", async () => {
    const { client } = makeClient({ list: [ROW] });
    const outcome = await readTool(client, "user-1", { domain: "deen", entity: "prayer", detail: "full" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const { items } = JSON.parse(block.text);
    expect(items[0]).toMatchObject({ id: "p1", updated_at: "2026-09-08T11:00:00Z", date: "2026-09-08", prayer_name: "fajr", status: "on_time" });
    expect(items[0]).not.toHaveProperty("user_id");
  });

  it("rejects an invalid detail value", async () => {
    const { client } = makeClient({ list: [] });
    await expect(
      readTool(client, "user-1", { domain: "deen", entity: "prayer", detail: "everything" as never }),
    ).rejects.toThrow(/invalid detail/i);
  });
});

describe("readTool — fields override", () => {
  it("narrows to exactly the requested fields when they're all within fullColumns", async () => {
    const { client } = makeClient({ list: [ROW] });
    const outcome = await readTool(client, "user-1", { domain: "deen", entity: "prayer", detail: "full", fields: ["status"] });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const { items } = JSON.parse(block.text);
    expect(items[0]).toEqual({ id: "p1", updated_at: "2026-09-08T11:00:00Z", status: "on_time" });
  });

  it("NEVER widens past fullColumns — a field outside the entity's registered allowlist is rejected, not silently dropped", async () => {
    const { client } = makeClient({ list: [] });
    await expect(
      readTool(client, "user-1", { domain: "deen", entity: "prayer", fields: ["encrypted_key"] }),
    ).rejects.toThrow(/not available.*encrypted_key/i);
  });
});

describe("readTool — filter", () => {
  it("applies a filter on an allowed column", async () => {
    const { client, eqCalls } = makeClient({ list: [ROW] });
    await readTool(client, "user-1", { domain: "deen", entity: "prayer", filter: { status: "on_time" } });
    expect(eqCalls).toContainEqual(["status", "on_time"]);
  });

  it("REJECTS a filter on a column not in filterableColumns — never silently ignored or widened", async () => {
    const { client } = makeClient({ list: [] });
    await expect(
      readTool(client, "user-1", { domain: "deen", entity: "prayer", filter: { user_id: "someone-elses-id" } }),
    ).rejects.toThrow(/not filterable/i);
  });
});

describe("readTool — pagination", () => {
  it("reports has_more and a cursor when more rows exist than the page", async () => {
    const { client, getLastRange } = makeClient({ list: [ROW], count: 50 });
    const outcome = await readTool(client, "user-1", { domain: "deen", entity: "prayer" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const payload = JSON.parse(block.text);
    expect(payload.has_more).toBe(true);
    expect(payload.cursor).not.toBeNull();
    expect(getLastRange()).toEqual([0, 19]); // page size 20, offset 0
  });

  it("reports has_more:false and cursor:null on the last page", async () => {
    const { client } = makeClient({ list: [ROW], count: 1 });
    const outcome = await readTool(client, "user-1", { domain: "deen", entity: "prayer" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const payload = JSON.parse(block.text);
    expect(payload.has_more).toBe(false);
    expect(payload.cursor).toBeNull();
  });

  it("a returned cursor, passed back in, resumes at the correct offset", async () => {
    const first = makeClient({ list: [ROW], count: 50 });
    const firstOutcome = await readTool(first.client, "user-1", { domain: "deen", entity: "prayer" });
    const firstBlock = firstOutcome.result.content[0];
    if (firstBlock.type !== "text") throw new Error("expected text");
    const { cursor } = JSON.parse(firstBlock.text);

    const second = makeClient({ list: [ROW], count: 50 });
    await readTool(second.client, "user-1", { domain: "deen", entity: "prayer", cursor });
    expect(second.getLastRange()).toEqual([1, 20]); // one row consumed by page 1, offset advances by 1
  });

  it("always scopes the list query to this user_id", async () => {
    const { client, eqCalls } = makeClient({ list: [ROW] });
    await readTool(client, "user-1", { domain: "deen", entity: "prayer" });
    expect(eqCalls).toContainEqual(["user_id", "user-1"]);
  });
});

describe("readTool — self_mastery/source_chunks, the registered-but-empty-allowlist case (memo §3)", () => {
  const CHUNK_ROW = { id: "c1", text: "the actual book text", embedding: [0.1, 0.2], user_id: "user-1" };

  it("even at detail:'full', returns ONLY {id, updated_at} — the raw text/embedding never reach the column list", async () => {
    const { client } = makeClient({ list: [CHUNK_ROW] });
    const outcome = await readTool(client, "user-1", { domain: "self_mastery", entity: "source_chunks", detail: "full" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const { items } = JSON.parse(block.text);
    expect(items).toEqual([{ id: "c1", updated_at: null }]);
  });

  it("REJECTS a fields request for 'text' — an allowlist of zero columns has nothing to widen into", async () => {
    const { client } = makeClient({ list: [] });
    await expect(
      readTool(client, "user-1", { domain: "self_mastery", entity: "source_chunks", fields: ["text"] }),
    ).rejects.toThrow(/not available.*text/i);
  });

  it("REJECTS a fields request for 'embedding' the same way", async () => {
    const { client } = makeClient({ list: [] });
    await expect(
      readTool(client, "user-1", { domain: "self_mastery", entity: "source_chunks", fields: ["embedding"] }),
    ).rejects.toThrow(/not available.*embedding/i);
  });
});

describe("readTool — fixedFilter (business.weekly_goal, shared table scoped by a column the caller never controls)", () => {
  it("applies the entity's fixedFilter on a list query, in addition to user_id", async () => {
    const { client, eqCalls } = makeClient({ list: [] });
    await readTool(client, "user-1", { domain: "business", entity: "weekly_goal" });
    expect(eqCalls).toContainEqual(["domain", "business"]);
    expect(eqCalls).toContainEqual(["user_id", "user-1"]);
  });

  it("applies the entity's fixedFilter on a single-id lookup too", async () => {
    const { client, eqCalls } = makeClient({ single: { id: "g1", week_start_date: "2026-09-08", headline: "Ship it", milestones: [] } });
    await readTool(client, "user-1", { domain: "business", entity: "weekly_goal", id: "g1" });
    expect(eqCalls).toContainEqual(["domain", "business"]);
  });

  it("a caller cannot override the fixed domain via `filter` — 'domain' isn't in weekly_goal's filterableColumns at all", async () => {
    const { client } = makeClient({ list: [] });
    await expect(
      readTool(client, "user-1", { domain: "business", entity: "weekly_goal", filter: { domain: "deen" } }),
    ).rejects.toThrow(/not filterable/i);
  });
});

describe("readTool — fixedFilter null discriminant (review.night_plan_task, tasks.domain IS NULL)", () => {
  it("uses .is(col, null), NEVER .eq(col, null), on a list query", async () => {
    const { client, eqCalls, isCalls } = makeClient({ list: [] });
    await readTool(client, "user-1", { domain: "review", entity: "night_plan_task" });
    expect(isCalls).toContainEqual(["domain", null]);
    // The real bug this exists to avoid: PostgREST reads .eq(col, null) as
    // `col = NULL`, which SQL always evaluates false -- it would silently
    // return zero rows forever, not throw, so this has to be asserted
    // directly rather than inferred from the call succeeding.
    expect(eqCalls).not.toContainEqual(["domain", null]);
    expect(eqCalls).toContainEqual(["user_id", "user-1"]);
  });

  it("uses .is(col, null) on a single-id lookup too", async () => {
    const { client, isCalls } = makeClient({ single: { id: "t1", title: "Buy stamps", planned_date: "2026-09-10", mit_rank: null } });
    await readTool(client, "user-1", { domain: "review", entity: "night_plan_task", id: "t1" });
    expect(isCalls).toContainEqual(["domain", null]);
  });

  it("a caller cannot override the null discriminant via `filter` — 'domain' isn't in night_plan_task's filterableColumns at all", async () => {
    const { client } = makeClient({ list: [] });
    await expect(
      readTool(client, "user-1", { domain: "review", entity: "night_plan_task", filter: { domain: "school" } }),
    ).rejects.toThrow(/not filterable/i);
  });

  it("school.task (a plain string fixedFilter, unaffected by the null-discriminant change) still uses .eq, not .is", async () => {
    const { client, eqCalls, isCalls } = makeClient({ list: [] });
    await readTool(client, "user-1", { domain: "school", entity: "task" });
    expect(eqCalls).toContainEqual(["domain", "school"]);
    expect(isCalls).toEqual([]);
  });
});

// R12 (PROGRAM-PLAN.md): the 20-row page cap is a model-context constraint
// and does not transfer to the widget render path. readTool gains an
// optional, explicitly-bounded row limit -- never reachable through `args`,
// never the MCP route's own behavior.
describe("readTool — ReadToolOptions.maxRows (R12)", () => {
  it("POSITIVE CONTROL: getLastRange() actually reflects the range a call makes -- proven by varying it BEFORE trusting it to report an unchanged default below", async () => {
    const { client, getLastRange } = makeClient({ list: [], count: 0 });
    await readTool(client, "user-1", { domain: "deen", entity: "prayer" }, { maxRows: 5 });
    // If getLastRange() here read back [0, 19] (the default), it would mean
    // the recorder can't actually see maxRows taking effect, and the "no
    // fourth argument -> still 20" test below would be proving nothing.
    expect(getLastRange()).toEqual([0, 4]);
  });

  it("with no options (the MCP route's own call shape), pages at the unconditional default of 20", async () => {
    const { client, getLastRange } = makeClient({ list: [], count: 0 });
    await readTool(client, "user-1", { domain: "deen", entity: "prayer" });
    expect(getLastRange()).toEqual([0, 19]);
  });

  it("options.maxRows raises the page size for this call only, and fetches the full range in one call", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, date: "2026-09-08" }));
    const { client, getLastRange } = makeClient({ list: rows, count: 30 });
    const outcome = await readTool(client, "user-1", { domain: "deen", entity: "prayer" }, { maxRows: 30 });
    expect(getLastRange()).toEqual([0, 29]);
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const payload = JSON.parse(block.text);
    expect(payload.items).toHaveLength(30); // all 30 in one page -- this is the point of raising the limit
    expect(payload.has_more).toBe(false); // exactly 30 of 30 fetched in one page of size 30
  });

  it("when count is unknown (null), has_more is computed against the OVERRIDDEN page size, not the hardcoded 20 -- a page of exactly 20 rows under maxRows:30 must read as NOT full", async () => {
    // This is the scenario a hardcoded `rows.length === PAGE_SIZE` (rather
    // than the local, possibly-overridden `pageSize`) would get wrong: 20
    // rows happens to equal the OLD constant, so a bug here would silently
    // report has_more:true (a phantom next page) even though the real page
    // size was 30 and 20 < 30 means this page just wasn't full. Built
    // directly (not via makeClient) because `count: null` specifically --
    // distinct from "count omitted" -- can't pass through makeClient's own
    // `opts.count ?? rows.length` fallback (`??` treats null like undefined).
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, date: "2026-09-08" }));
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.range = vi.fn(async () => ({ data: rows, error: null, count: null }));
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const outcome = await readTool(client, "user-1", { domain: "deen", entity: "prayer" }, { maxRows: 30 });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text).has_more).toBe(false);
  });
});

describe("readTool — P4-04 total, limit, range filters", () => {
  function rangeClient(opts: { list?: unknown[]; count?: number | null } = {}) {
    const calls: [string, string, unknown][] = [];
    let lastRange: [number, number] | null = null;
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    for (const op of ["eq", "gte", "lte"]) {
      chain[op] = vi.fn((col: string, val: unknown) => {
        calls.push([op, col, val]);
        return chain;
      });
    }
    chain.range = vi.fn(async (a: number, b: number) => {
      lastRange = [a, b];
      const list = opts.list ?? [];
      return { data: list, error: null, count: opts.count === undefined ? list.length : opts.count };
    });
    return { client: { from: vi.fn(() => chain) } as unknown as SupabaseClient, calls, getLastRange: () => lastRange };
  }

  function payloadOf(outcome: Awaited<ReturnType<typeof readTool>>) {
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    return JSON.parse(block.text);
  }

  it("returns total from the exact count it already computes", async () => {
    const { client } = rangeClient({ list: [ROW], count: 57 });
    expect(payloadOf(await readTool(client, "user-1", { domain: "deen", entity: "prayer" }))).toMatchObject({ total: 57, has_more: true });
  });

  it("total is null when the count is unavailable", async () => {
    const { client } = rangeClient({ list: [ROW], count: null });
    expect(payloadOf(await readTool(client, "user-1", { domain: "deen", entity: "prayer" })).total).toBeNull();
  });

  it("limit narrows the page (e.g. just the latest 3)", async () => {
    const { client, getLastRange } = rangeClient({ list: [ROW, ROW, ROW], count: 10 });
    const payload = payloadOf(await readTool(client, "user-1", { domain: "deen", entity: "prayer", limit: 3 }));
    expect(getLastRange()).toEqual([0, 2]);
    expect(payload.has_more).toBe(true);
  });

  it.each([0, 21, 2.5, -1])("limit %s is rejected with the valid range, as a model-visible input error", async (limit) => {
    const { client } = rangeClient();
    const { ToolInputError } = await import("../../tool-input-error");
    const err = await readTool(client, "user-1", { domain: "deen", entity: "prayer", limit }).catch((e) => e);
    expect(err).toBeInstanceOf(ToolInputError);
    expect((err as Error).message).toMatch(/limit must be an integer from 1 to 20/);
  });

  it("options.maxRows (widgets only) still wins over any limit", async () => {
    const { client, getLastRange } = rangeClient();
    await readTool(client, "user-1", { domain: "deen", entity: "prayer", limit: 3 }, { maxRows: 30 });
    expect(getLastRange()).toEqual([0, 29]);
  });

  it("a {gte,lte} range on a declared range column applies both bounds", async () => {
    const { client, calls } = rangeClient();
    await readTool(client, "user-1", { domain: "deen", entity: "prayer", filter: { date: { gte: "2026-09-08", lte: "2026-09-14" } } });
    expect(calls).toEqual(expect.arrayContaining([["gte", "date", "2026-09-08"], ["lte", "date", "2026-09-14"]]));
    expect(calls.find(([op, col]) => op === "eq" && col === "date")).toBeUndefined();
  });

  it("a range on a column that isn't range-filterable is refused, naming the allowed set", async () => {
    const { client } = rangeClient();
    const { ToolInputError } = await import("../../tool-input-error");
    const err = await readTool(client, "user-1", { domain: "deen", entity: "prayer", filter: { status: { gte: "a" } } }).catch((e) => e);
    expect(err).toBeInstanceOf(ToolInputError);
    expect((err as Error).message).toMatch(/"status" can't be range-filtered on entity "prayer"\. Range-filterable: date/);
  });

  it.each([[{}], [{ gte: "2026-01-01", after: "x" }], [{ gte: { nested: 1 } }]])("a malformed range object %j is refused", async (range) => {
    const { client } = rangeClient();
    const { ToolInputError } = await import("../../tool-input-error");
    const err = await readTool(client, "user-1", { domain: "deen", entity: "prayer", filter: { date: range as never } }).catch((e) => e);
    expect(err).toBeInstanceOf(ToolInputError);
    expect((err as Error).message).toMatch(/filter\.date range must be \{ gte\?, lte\? \}/);
  });
});
