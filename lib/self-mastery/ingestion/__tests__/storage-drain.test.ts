import { describe, it, expect, vi } from "vitest";
import { drainPendingStorageDeletions, DRAIN_LIMIT } from "../storage-drain";

type Row = { id: string; storage_path: string; user_id: string; attempts: number; max_attempts: number; last_error: string | null; created_at: string };

function fake(rows: Row[], removeImpl?: (paths: string[]) => Promise<{ data: unknown; error: { message: string } | null }>) {
  const removed: string[][] = [];
  const limits: number[] = [];
  const remove = vi.fn(async (paths: string[]) => {
    removed.push(paths);
    return removeImpl ? removeImpl(paths) : { data: paths.map((name) => ({ name })), error: null };
  });
  const from = (table: string) => {
    if (table !== "pending_storage_deletions") throw new Error(`unexpected table ${table}`);
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Partial<Row> | null = null;
    let isDelete = false;
    let inIds: string[] | null = null;
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.update = (p: Partial<Row>) => ((patch = p), c);
    c.delete = () => ((isDelete = true), c);
    c.lt = (col: keyof Row, v: unknown) => (filters.push((r) => (r[col] as number) < (v as number)), c);
    c.returns = () => c;
    c.eq = (col: keyof Row, v: unknown) => (filters.push((r) => r[col] === v), c);
    c.in = (col: keyof Row, vs: unknown[]) => ((inIds = vs as string[]), filters.push((r) => vs.includes(r[col])), c);
    c.order = () => c;
    c.limit = (n: number) => (limits.push(n), c);
    c.then = (resolve: (v: unknown) => void) => {
      // attempts < max_attempts is applied as a column comparison the way the DB would
      const live = rows.filter((r) => r.attempts < r.max_attempts && filters.every((f) => f(r)));
      if (isDelete) {
        for (const r of live) rows.splice(rows.indexOf(r), 1);
        resolve({ data: null, error: null });
      } else if (patch) {
        for (const r of live) Object.assign(r, patch);
        resolve({ data: null, error: null });
      } else {
        resolve({ data: live.slice(0, limits.at(-1) ?? 1000), error: null });
      }
      void inIds;
    };
    return c;
  };
  return { supabase: { from, storage: { from: () => ({ remove }) } } as never, removed, remove, limits };
}

const row = (id: string, user = "u1", over: Partial<Row> = {}): Row => ({ id, storage_path: `${user}/${id}.pdf`, user_id: user, attempts: 0, max_attempts: 5, last_error: null, created_at: "2026-10-01T00:00:00Z", ...over });

describe("drainPendingStorageDeletions", () => {
  it("removes the queued objects from the books bucket and clears their rows", async () => {
    const rows = [row("a"), row("b")];
    const { supabase, removed } = fake(rows);
    const r = await drainPendingStorageDeletions(supabase);
    expect(removed).toEqual([["u1/a.pdf", "u1/b.pdf"]]);
    expect(rows).toHaveLength(0);
    expect(r).toEqual({ deleted: 2, failed: 0, skipped: 0 });
  });

  it("is idempotent: an object that is already gone still clears its row, and a second drain finds nothing", async () => {
    const rows = [row("a")];
    const { supabase, remove } = fake(rows, async () => ({ data: [], error: null })); // Supabase answers success with no objects for a missing path
    expect((await drainPendingStorageDeletions(supabase)).deleted).toBe(1);
    expect(rows).toHaveLength(0);
    await drainPendingStorageDeletions(supabase);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("a failing delete keeps the row, counts the attempt and records why; at max_attempts it is no longer picked", async () => {
    const rows = [row("a", "u1", { attempts: 3 })];
    const { supabase } = fake(rows, async () => ({ data: null, error: { message: "storage down" } }));
    expect((await drainPendingStorageDeletions(supabase)).failed).toBe(1);
    expect(rows[0]).toMatchObject({ attempts: 4, last_error: "storage down" });
    await drainPendingStorageDeletions(supabase); // 5th attempt
    expect(rows[0]!.attempts).toBe(5);
    const { supabase: s2, remove } = fake(rows);
    await drainPendingStorageDeletions(s2);
    expect(remove).not.toHaveBeenCalled(); // exhausted rows stay in the table for a human, untouched
  });

  it("never deletes a path outside its own user's folder (a bad row is parked, not executed)", async () => {
    const rows = [row("a", "u1", { storage_path: "someone-else/x.pdf" }), row("b")];
    const { supabase, removed } = fake(rows);
    const r = await drainPendingStorageDeletions(supabase);
    expect(removed).toEqual([["u1/b.pdf"]]);
    expect(r).toMatchObject({ deleted: 1, skipped: 1 });
    expect(rows.find((x) => x.id === "a")).toMatchObject({ attempts: 5, last_error: expect.stringMatching(/outside/) });
  });

  it("is bounded: one query for at most DRAIN_LIMIT rows per call", async () => {
    const rows = Array.from({ length: DRAIN_LIMIT + 10 }, (_, i) => row(`r${i}`));
    const { supabase, removed, limits } = fake(rows);
    await drainPendingStorageDeletions(supabase);
    expect(limits[0]).toBe(DRAIN_LIMIT);
    expect(removed[0]).toHaveLength(DRAIN_LIMIT);
    expect(rows).toHaveLength(10);
  });

  it("does nothing when the queue is empty, and never throws when the database is down", async () => {
    const { supabase, remove } = fake([]);
    expect(await drainPendingStorageDeletions(supabase)).toEqual({ deleted: 0, failed: 0, skipped: 0 });
    expect(remove).not.toHaveBeenCalled();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { from: () => { throw new Error("db down"); } } as never;
    await expect(drainPendingStorageDeletions(broken)).resolves.toEqual({ deleted: 0, failed: 0, skipped: 0 });
    spy.mockRestore();
  });
});
