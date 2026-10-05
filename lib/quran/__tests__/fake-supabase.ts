import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

/**
 * A tiny in-memory stand-in for the two tables the Quran cores touch (quran_plans, quran_sessions): chainable
 * select/insert/update/delete with eq / in / gte / not-is-null / order / limit and maybeSingle / single, so the cores'
 * real logic (guards, ordering, compensation) runs for real. `failNext` makes the next matching call return an error.
 */
export function fakeSupabase(seed: { quran_plans?: Row[]; quran_sessions?: Row[] } = {}) {
  const tables: Record<string, Row[]> = { quran_plans: [...(seed.quran_plans ?? [])], quran_sessions: [...(seed.quran_sessions ?? [])] };
  let counter = 0;
  const failures: Array<{ table: string; op: string; error: { code?: string; message: string } }> = [];
  const log: Array<{ table: string; op: string; values?: Row }> = [];

  const from = (table: string) => {
    let op: "select" | "insert" | "update" | "delete" = "select";
    let values: Row = {};
    const filters: Array<(r: Row) => boolean> = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    let wantsRows = false;

    const run = () => {
      const f = failures.findIndex((x) => x.table === table && x.op === op);
      if (f >= 0) {
        const [fail] = failures.splice(f, 1);
        return { data: null, error: fail.error };
      }
      const rows = tables[table];
      const matched = () => rows.filter((r) => filters.every((fn) => fn(r)));
      if (op === "insert") {
        const row: Row = { id: `id-${++counter}`, created_at: new Date(2026, 9, 4, 12, 0, counter).toISOString(), ...values };
        if (table === "quran_plans" && ["active", "paused"].includes(String(row.status ?? "active"))) {
          row.status = row.status ?? "active";
          if (rows.some((r) => r.user_id === row.user_id && ["active", "paused"].includes(String(r.status)))) {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint quran_plans_one_open_per_user" } };
          }
        }
        rows.push(row);
        log.push({ table, op, values: row });
        return { data: row, error: null };
      }
      if (op === "update") {
        const hit = matched();
        for (const r of hit) Object.assign(r, values);
        if (hit.length) log.push({ table, op, values });
        return { data: wantsRows ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      if (op === "delete") {
        const hit = matched();
        tables[table] = rows.filter((r) => !hit.includes(r));
        if (hit.length) log.push({ table, op });
        return { data: null, error: null };
      }
      let out = matched().map((r) => ({ ...r }));
      if (orderBy) {
        const { col, asc } = orderBy;
        out = out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (limitN !== null) out = out.slice(0, limitN);
      return { data: out, error: null };
    };

    const chain: Record<string, unknown> = {};
    chain.select = () => ((wantsRows = true), chain);
    chain.insert = (v: Row) => ((op = "insert"), (values = v), chain);
    chain.update = (v: Row) => ((op = "update"), (values = v), chain);
    chain.delete = () => ((op = "delete"), chain);
    chain.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain);
    chain.in = (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), chain);
    chain.gte = (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), chain);
    chain.not = (c: string, _o: string, _v: unknown) => (filters.push((r) => r[c] !== null && r[c] !== undefined), chain);
    chain.order = (c: string, o?: { ascending?: boolean }) => ((orderBy = { col: c, asc: o?.ascending !== false }), chain);
    chain.limit = (n: number) => ((limitN = n), chain);
    chain.maybeSingle = async () => {
      const res = run();
      if (res.error) return res;
      const list = res.data as Row[];
      return { data: list[0] ?? null, error: null };
    };
    chain.single = async () => run();
    chain.then = (resolve: (v: unknown) => void) => resolve(run());
    return chain;
  };

  return {
    client: { from } as unknown as SupabaseClient,
    tables,
    log,
    failNext: (table: string, op: string, error: { code?: string; message: string } = { message: "boom" }) => failures.push({ table, op, error }),
  };
}

export const U = "user-1";

export function planRow(over: Row = {}): Row {
  return {
    id: "plan-1", user_id: U, khatm_number: 1, start_date: "2026-10-04", start_page: 1, plan_set_on: "2026-10-04", plan_set_page: 1,
    target_date: "2026-12-02", pace_pages_per_day: null, original_pace_pages_per_day: 10.07, current_page: 1, status: "active",
    paused_on: null, paused_days: 0, completed_on: null, ...over,
  };
}
