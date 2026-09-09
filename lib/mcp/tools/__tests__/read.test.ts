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
  const orderCalls: [string, boolean][] = [];
  let lastRange: [number, number] | null = null;

  const from = vi.fn((_table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
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

  return { client: { from } as unknown as SupabaseClient, eqCalls, orderCalls, getLastRange: () => lastRange };
}

describe("resolveReadOperation", () => {
  it("is domain.entity.read", () => {
    expect(resolveReadOperation({ domain: "deen", entity: "prayer" })).toBe("deen.prayer.read");
  });
});

describe("readTool — unknown domain/entity", () => {
  it("REJECTS an unknown domain, naming the valid set", async () => {
    const { client } = makeClient();
    await expect(readTool(client, "user-1", { domain: "fitness", entity: "x" })).rejects.toThrow(/unknown domain.*fitness/i);
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

  it("detail:'full' includes every registered column, including user_id", async () => {
    const { client } = makeClient({ list: [ROW] });
    const outcome = await readTool(client, "user-1", { domain: "deen", entity: "prayer", detail: "full" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const { items } = JSON.parse(block.text);
    expect(items[0]).toMatchObject({ id: "p1", updated_at: "2026-09-08T11:00:00Z", user_id: "user-1" });
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
