import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction } from "../write-registry";
import { ToolInputError, ToolNotFoundError } from "../tool-input-error";

/**
 * business.kill_list_item set / set_completed / clear, the writes the MyHomeBase console sync calls (kill_list scope). A tiny STATEFUL fake of the two tables the writes touch
 * (kill_list_items, tasks), so "idempotent" is asserted on state, not on call shapes: a second identical call leaves the rows byte-for-byte as the first did.
 */

type Row = Record<string, unknown>;
function fakeDb(seed: Row[] = []) {
  const items: Row[] = seed.map((r) => ({ ...r }));
  const taskUpdates: { patch: Row; where: Record<string, unknown> }[] = [];
  let clock = 0;
  const stamp = () => `2026-11-02T10:00:${String(clock++).padStart(2, "0")}.000Z`;
  function from(table: string) {
    const filters: [string, unknown][] = [];
    let op: "select" | "update" | "delete" | "upsert" = "select";
    let patch: Row = {};
    let wantRows = false;
    const matches = () => items.filter((r) => filters.every(([c, v]) => r[c] === v));
    const run = (): { data: unknown; error: null } => {
      if (table === "tasks") {
        if (op === "update") taskUpdates.push({ patch, where: Object.fromEntries(filters) });
        return { data: null, error: null };
      }
      if (op === "upsert") {
        const ex = items.find((r) => r.user_id === patch.user_id && r.date === patch.date && r.position === patch.position);
        if (ex) { ex.text = patch.text; ex.updated_at = stamp(); }
        else items.push({ id: `id-${items.length + 1}`, completed: false, completed_at: null, created_at: stamp(), updated_at: stamp(), ...patch });
        return { data: null, error: null };
      }
      const hit = matches();
      if (op === "update") { for (const r of hit) Object.assign(r, patch, { updated_at: stamp() }); return { data: wantRows ? hit.map((r) => ({ ...r })) : null, error: null }; }
      if (op === "delete") { for (const r of hit) items.splice(items.indexOf(r), 1); return { data: wantRows ? hit.map((r) => ({ id: r.id })) : null, error: null }; }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => { wantRows = true; return chain; },
      eq: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
      update: (p: Row) => { op = "update"; patch = p; return chain; },
      delete: () => { op = "delete"; return chain; },
      upsert: (p: Row) => { op = "upsert"; patch = p; return chain; },
      maybeSingle: async () => { const r = run(); return { data: (r.data as Row[])[0] ?? null, error: null }; },
      then: (resolve: (v: unknown) => unknown) => resolve(run()),
    };
    return chain;
  }
  return { client: { from } as unknown as SupabaseClient, items, taskUpdates };
}

const ctx = (client: SupabaseClient) => ({ userClient: client, userId: "u1", timezone: "UTC", now: new Date("2026-11-02T12:00:00Z") });
const out = (o: { result: { structuredContent?: unknown } }) => o.result.structuredContent as Record<string, unknown>;
const D = "2026-11-02";
const act = (name: string) => getWriteAction("business", "kill_list_item", name)!;
const row = (over: Row = {}): Row => ({ id: "i1", user_id: "u1", date: D, position: 0, text: "Call the roofers", completed: false, completed_at: null, created_at: "c", updated_at: "u", ...over });

describe("set (the text of a slot)", () => {
  it("creates the slot and returns its real id, updated_at and completed state", async () => {
    const { client, items } = fakeDb();
    const o = out(await act("set").handler(ctx(client), { date: D, position: 1, text: "Send the invoices" }));
    expect(items).toHaveLength(1);
    expect(o).toMatchObject({ id: items[0].id, date: D, position: 1, text: "Send the invoices", completed: false });
    expect(o.updated_at).toBe(items[0].updated_at);
  });
  it("overwrites the text of an existing slot and KEEPS its completed state", async () => {
    const { client, items } = fakeDb([row({ completed: true, completed_at: "t" })]);
    const o = out(await act("set").handler(ctx(client), { date: D, position: 0, text: "Call the roofers again" }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ text: "Call the roofers again", completed: true });
    expect(o).toMatchObject({ id: "i1", completed: true });
  });
  it("rejects a bad date and an out-of-range position as the caller's input error", async () => {
    const { client } = fakeDb();
    for (const patch of [{ date: "2026-13-40", position: 0, text: "x" }, { date: "tomorrow", position: 0, text: "x" }, { date: D, position: 3, text: "x" }, { date: D, position: 0, text: "" }]) {
      await expect(act("set").handler(ctx(client), patch)).rejects.toBeInstanceOf(ToolInputError);
    }
  });
});

describe("set_completed", () => {
  it("checks a slot, stamps completed_at once, and carries it to the paired task", async () => {
    const { client, items, taskUpdates } = fakeDb([row()]);
    const o = out(await act("set_completed").handler(ctx(client), { date: D, position: 0, completed: true }));
    expect(o).toMatchObject({ id: "i1", completed: true, changed: true });
    expect(items[0].completed_at).toEqual(expect.any(String));
    expect(taskUpdates).toHaveLength(1);
    expect(taskUpdates[0].patch).toMatchObject({ completed: true });
    expect(taskUpdates[0].where).toMatchObject({ kill_list_item_id: "i1", user_id: "u1" });
  });
  it("is idempotent: the same value again changes NOTHING (completed_at and updated_at are not re-stamped, no task write)", async () => {
    const { client, items, taskUpdates } = fakeDb([row()]);
    await act("set_completed").handler(ctx(client), { date: D, position: 0, completed: true });
    const after1 = JSON.stringify(items);
    const o = out(await act("set_completed").handler(ctx(client), { date: D, position: 0, completed: true }));
    expect(o.changed).toBe(false);
    expect(JSON.stringify(items)).toBe(after1);
    expect(taskUpdates).toHaveLength(1);
  });
  it("unchecks: completed false and completed_at null; unchecking an unchecked slot is a no-op", async () => {
    const { client, items } = fakeDb([row({ completed: true, completed_at: "t" })]);
    const o = out(await act("set_completed").handler(ctx(client), { date: D, position: 0, completed: false }));
    expect(o).toMatchObject({ completed: false, completed_at: null, changed: true });
    expect(items[0]).toMatchObject({ completed: false, completed_at: null });
    expect(out(await act("set_completed").handler(ctx(client), { date: D, position: 0, completed: false })).changed).toBe(false);
  });
  it("an empty slot is not_found (the console sets the text first); bad input is invalid_input", async () => {
    const { client } = fakeDb();
    await expect(act("set_completed").handler(ctx(client), { date: D, position: 2, completed: true })).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(act("set_completed").handler(ctx(client), { date: D, position: 2, completed: "yes" })).rejects.toBeInstanceOf(ToolInputError);
    await expect(act("set_completed").handler(ctx(client), { date: "nope", position: 2, completed: true })).rejects.toBeInstanceOf(ToolInputError);
  });
  it("only touches the named day and slot", async () => {
    const { client, items } = fakeDb([row(), row({ id: "i2", position: 1 }), row({ id: "i3", date: "2026-11-01" })]);
    await act("set_completed").handler(ctx(client), { date: D, position: 0, completed: true });
    expect(items.filter((r) => r.completed).map((r) => r.id)).toEqual(["i1"]);
  });
});

describe("clear", () => {
  it("removes the slot and is idempotent (an empty slot is cleared:false, not an error)", async () => {
    const { client, items } = fakeDb([row(), row({ id: "i2", position: 1 })]);
    expect(out(await act("clear").handler(ctx(client), { date: D, position: 0 }))).toEqual({ date: D, position: 0, cleared: true });
    expect(items.map((r) => r.id)).toEqual(["i2"]);
    expect(out(await act("clear").handler(ctx(client), { date: D, position: 0 }))).toEqual({ date: D, position: 0, cleared: false });
    expect(items.map((r) => r.id)).toEqual(["i2"]);
  });
  it("never touches another day, another position, or a task row (the link is released by the FK, not by a write)", async () => {
    const { client, items, taskUpdates } = fakeDb([row(), row({ id: "i3", date: "2026-11-01" })]);
    await act("clear").handler(ctx(client), { date: D, position: 0 });
    expect(items.map((r) => r.id)).toEqual(["i3"]);
    expect(taskUpdates).toHaveLength(0);
  });
  it("rejects a bad date or position", async () => {
    const { client } = fakeDb();
    await expect(act("clear").handler(ctx(client), { date: "x", position: 0 })).rejects.toBeInstanceOf(ToolInputError);
    await expect(act("clear").handler(ctx(client), { date: D, position: 5 })).rejects.toBeInstanceOf(ToolInputError);
  });
});
