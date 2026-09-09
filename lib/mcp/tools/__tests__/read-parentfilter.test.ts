import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readTool } from "../read";

/**
 * Exercises the `parentFilter` mechanism (lib/mcp/registry.ts's EntityDef
 * field, enforced in read.ts) against a REAL registered entity —
 * school.schedule_event_override — rather than a synthetic one, so these
 * tests double as proof the retrofit actually works end-to-end.
 */
function makeClient(opts: { parentRow?: { id: string } | null; childRows?: Record<string, unknown>[]; childSingle?: Record<string, unknown> | null }) {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    if (table === "schedule_events") {
      chain.maybeSingle = vi.fn(async () => ({ data: opts.parentRow ?? null, error: null }));
    } else {
      chain.maybeSingle = vi.fn(async () => ({ data: opts.childSingle ?? null, error: null }));
      chain.range = vi.fn(async () => ({ data: opts.childRows ?? [], error: null, count: (opts.childRows ?? []).length }));
    }
    return chain;
  });
  return { from } as unknown as SupabaseClient;
}

describe("readTool — parentFilter, list path", () => {
  it("REJECTS a list call with no filter.event_id — never an unscoped dump across every event", async () => {
    const client = makeClient({ parentRow: { id: "event-1" } });
    await expect(readTool(client, "user-1", { domain: "school", entity: "schedule_event_override" })).rejects.toThrow(
      /requires filter\.event_id/i,
    );
  });

  it("REJECTS when the named parent event doesn't belong to this user or isn't domain='school'", async () => {
    const client = makeClient({ parentRow: null }); // school's schedule_events lookup (fixedFilter domain:school + user_id) found nothing
    await expect(
      readTool(client, "user-1", { domain: "school", entity: "schedule_event_override", filter: { event_id: "co-op-event" } }),
    ).rejects.toThrow(/no parent schedule_events row/i);
  });

  it("ACCEPTS and lists when the parent event is verified school-owned", async () => {
    const client = makeClient({
      parentRow: { id: "event-1" },
      childRows: [{ id: "ov-1", event_id: "event-1", date: "2026-09-15", event_time: "15:00", end_time: null, updated_at: "2026-09-10T00:00:00Z" }],
    });
    const outcome = await readTool(client, "user-1", { domain: "school", entity: "schedule_event_override", filter: { event_id: "event-1" } });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    const payload = JSON.parse(block.text);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({ id: "ov-1", event_id: "event-1", date: "2026-09-15" });
  });
});

describe("readTool — parentFilter, id path", () => {
  it("REJECTS an id lookup whose own event_id points at a non-school (or someone else's) event — can't bypass parentFilter by omitting `filter`", async () => {
    const client = makeClient({
      parentRow: null, // the override's event_id turns out not to resolve to a school-domain event
      childSingle: { id: "ov-1", event_id: "co-op-event", date: "2026-09-15", event_time: "15:00", end_time: null, updated_at: null },
    });
    await expect(
      readTool(client, "user-1", { domain: "school", entity: "schedule_event_override", id: "ov-1" }),
    ).rejects.toThrow(/no parent schedule_events row/i);
  });

  it("ACCEPTS an id lookup whose event_id resolves to a verified school event", async () => {
    const client = makeClient({
      parentRow: { id: "event-1" },
      childSingle: { id: "ov-1", event_id: "event-1", date: "2026-09-15", event_time: "15:00", end_time: null, updated_at: "2026-09-10T00:00:00Z" },
    });
    const outcome = await readTool(client, "user-1", { domain: "school", entity: "schedule_event_override", id: "ov-1" });
    const block = outcome.result.content[0];
    if (block.type !== "text") throw new Error("expected text");
    expect(JSON.parse(block.text)).toMatchObject({ id: "ov-1", event_id: "event-1" });
  });
});
