import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tiny in-memory stand-in for the slice of PostgREST the book-stage planner / applier / sweep use: select / eq / neq / is / not / in / like /
 * order / limit / range / maybeSingle / update / insert / delete over plain arrays, plus rpc handlers. Not a general fake: just enough that a test
 * can seed rows in the SHAPE the bug lives in and assert on the resulting rows.
 */
type Row = Record<string, unknown>;
export interface FakeDb {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
}

export function makeFakeDb(
  seed: Record<string, Row[]>,
  rpcs: Record<string, (args: Record<string, unknown>, db: FakeDb) => unknown> = {},
): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const rpcCalls: FakeDb["rpcCalls"] = [];
  const db = { tables, rpcCalls } as FakeDb;

  const from = (table: string) => {
    tables[table] ??= [];
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "update" | "delete" = "select";
    let patch: Row = {};
    let orderBy: { col: string; asc: boolean } | null = null;
    let lim: number | null = null;
    let from_: number | null = null;
    let to_: number | null = null;
    let head = false;
    let countMode = false;
    const chain: Record<string, unknown> = {};
    const run = () => {
      let rows = tables[table]!.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of rows) Object.assign(r, patch);
        return { data: rows, error: null, count: rows.length };
      }
      if (op === "delete") {
        tables[table] = tables[table]!.filter((r) => !rows.includes(r));
        return { data: rows, error: null, count: rows.length };
      }
      if (orderBy) {
        const { col, asc } = orderBy;
        const cmp = (x: unknown, y: unknown) => (x === y ? 0 : (x as never) < (y as never) ? -1 : 1);
        rows = [...rows].sort((a, b) => cmp(a[col] ?? 0, b[col] ?? 0) * (asc ? 1 : -1));
      }
      const total = rows.length;
      if (from_ !== null && to_ !== null) rows = rows.slice(from_, to_ + 1);
      if (lim !== null) rows = rows.slice(0, lim);
      return { data: head ? null : rows, error: null, count: countMode ? total : null };
    };
    chain.select = vi.fn((_c?: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.count) countMode = true;
      if (opts?.head) head = true;
      return chain;
    });
    chain.eq = vi.fn((c: string, v: unknown) => (filters.push((r) => r[c] === v), chain));
    chain.neq = vi.fn((c: string, v: unknown) => (filters.push((r) => r[c] !== v), chain));
    chain.is = vi.fn((c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), chain));
    chain.not = vi.fn((c: string, o: string, v: unknown) => {
      if (o === "is") filters.push((r) => (r[c] ?? null) !== v);
      else if (o === "in") filters.push((r) => !String(v).replace(/[()]/g, "").split(",").includes(String(r[c])));
      return chain;
    });
    chain.lt = vi.fn((c: string, v: unknown) => (filters.push((r) => String(r[c]) < String(v)), chain));
    chain.gt = vi.fn((c: string, v: unknown) => (filters.push((r) => String(r[c]) > String(v)), chain));
    // PostgREST or(): "col.neq.v" and "col.not.is.null", comma-separated (the shapes the sweep uses).
    chain.or = vi.fn((expr: string) => {
      const preds = expr.split(",").map((part) => {
        const [col, op, ...rest] = part.split(".");
        if (op === "neq") return (r: Row) => r[col!] !== rest.join(".");
        if (op === "not" && rest.join(".") === "is.null") return (r: Row) => r[col!] != null;
        throw new Error(`fake or(): unsupported ${part}`);
      });
      filters.push((r) => preds.some((f) => f(r)));
      return chain;
    });
    chain.in = vi.fn((c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), chain));
    chain.like = vi.fn((c: string, pat: string) => {
      const re = new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
      filters.push((r) => re.test(String(r[c] ?? "")));
      return chain;
    });
    chain.order = vi.fn((col: string, o?: { ascending?: boolean }) => ((orderBy = { col, asc: o?.ascending !== false }), chain));
    chain.limit = vi.fn((n: number) => ((lim = n), chain));
    chain.range = vi.fn((a: number, b: number) => ((from_ = a), (to_ = b), chain));
    chain.update = vi.fn((p: Row) => ((op = "update"), (patch = p), chain));
    chain.delete = vi.fn(() => ((op = "delete"), chain));
    chain.insert = vi.fn((rows: Row | Row[]) => {
      const list = Array.isArray(rows) ? rows : [rows];
      const inserted: Row[] = [];
      for (const r of list) {
        const row = { id: `${table}-${tables[table]!.length + 1}`, ...r };
        tables[table]!.push(row);
        inserted.push(row);
      }
      return {
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
        select: () => ({ then: (resolve: (v: unknown) => void) => resolve({ data: inserted, error: null }) }),
      };
    });
    chain.maybeSingle = vi.fn(async () => {
      const r = run();
      return { data: (r.data as Row[] | null)?.[0] ?? null, error: null };
    });
    chain.single = chain.maybeSingle;
    chain.returns = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) => resolve(run());
    return chain;
  };

  db.client = {
    from,
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      const h = rpcs[fn];
      return { data: h ? h(args, db) : null, error: null };
    }),
  } as unknown as SupabaseClient;
  return db;
}
