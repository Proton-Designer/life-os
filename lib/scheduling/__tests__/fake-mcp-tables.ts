import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tiny in-memory PostgREST stand-in: real rows in real tables, so a test
 * can observe what a sequence of writes actually LEAVES behind (e.g. which
 * token a scheduled action points at after an OAuth refresh) instead of
 * asserting that some chain method was called.
 *
 * Supported shape (all the scheduler/token code under test needs):
 *   from(t).select(cols)            .eq/.is/.lte/.order/.limit   → await | .maybeSingle()
 *   from(t).update(patch)           .eq/.is/.lte/.order/.limit   → await | .select(cols)
 *   from(t).insert(row | rows)                                   → await
 *
 * Semantics that matter: an UPDATE matching 0 rows resolves `{data: [], error: null}`
 * exactly like PostgREST (no error). `failOn` lets a test force an error for
 * one (table, op) pair.
 */
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export interface FakeMcpDb {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  failOn: Set<string>; // e.g. "mcp_scheduled_actions:update"
}

export function makeFakeMcpDb(seed: Record<string, Row[]> = {}): FakeMcpDb {
  const tables: Record<string, Row[]> = {};
  for (const [t, rows] of Object.entries(seed)) tables[t] = rows.map((r) => ({ ...r }));
  const failOn = new Set<string>();

  function builder(table: string, op: "select" | "update" | "insert", payload?: Row | Row[]) {
    const filters: Filter[] = [];
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    let returning: string | null = op === "select" ? (payload as unknown as string | undefined) ?? "*" : null;

    const pick = (r: Row) =>
      !returning || returning === "*" ? { ...r } : Object.fromEntries(returning.split(",").map((c) => [c.trim(), r[c.trim()]]));

    const execute = (): { data: Row[] | null; error: { message: string } | null } => {
      if (failOn.has(`${table}:${op}`)) return { data: null, error: { message: `forced ${op} failure on ${table}` } };
      const rows = (tables[table] ??= []);
      if (op === "insert") {
        const list = Array.isArray(payload) ? payload : [payload as Row];
        for (const r of list) rows.push({ ...r });
        return { data: returning ? list.map(pick) : null, error: null };
      }
      let matched = rows.filter((r) => filters.every((f) => f(r)));
      if (order) {
        const { col, asc } = order;
        matched = [...matched].sort((a, b) => (String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : String(a[col]) > String(b[col]) ? (asc ? 1 : -1) : 0));
      }
      if (limit !== null) matched = matched.slice(0, limit);
      if (op === "update") {
        for (const r of matched) Object.assign(r, payload as Row);
        return { data: returning ? matched.map(pick) : null, error: null };
      }
      return { data: matched.map(pick), error: null };
    };

    let cached: ReturnType<typeof execute> | null = null;
    const run = () => (cached ??= execute());

    const b = {
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return b;
      },
      is(col: string, val: unknown) {
        filters.push((r) => (r[col] ?? null) === val);
        return b;
      },
      lte(col: string, val: string) {
        filters.push((r) => r[col] !== null && r[col] !== undefined && String(r[col]) <= val);
        return b;
      },
      order(col: string, o?: { ascending?: boolean }) {
        order = { col, asc: o?.ascending !== false };
        return b;
      },
      limit(n: number) {
        limit = n;
        return b;
      },
      select(cols = "*") {
        returning = cols;
        return b;
      },
      maybeSingle() {
        const { data, error } = run();
        if (error) return Promise.resolve({ data: null, error });
        if ((data?.length ?? 0) > 1) return Promise.resolve({ data: null, error: { message: "multiple rows" } });
        return Promise.resolve({ data: data?.[0] ?? null, error: null });
      },
      then(resolve: (v: ReturnType<typeof execute>) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return b;
  }

  const from = (table: string) => ({
    select: (cols?: string) => builder(table, "select", cols as unknown as Row),
    update: (patch: Row) => builder(table, "update", patch),
    insert: (row: Row | Row[]) => builder(table, "insert", row),
  });

  return { client: { from } as unknown as SupabaseClient, tables, failOn };
}
