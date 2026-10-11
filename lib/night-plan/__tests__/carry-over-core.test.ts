import { describe, expect, it } from "vitest";
import { carryOverCore } from "../carry-over-core";

type Op = { table: string; verb: "select" | "insert" | "update" | "delete" | "upsert"; payload?: unknown; filters: [string, unknown][] };

/** A recording fake of the Supabase builder: every call is logged; awaiting resolves the response registered for table+verb. */
function fake(responses: Record<string, unknown> = {}) {
  const ops: Op[] = [];
  const client = {
    from(table: string) {
      const op: Op = { table, verb: "select", filters: [] };
      const builder: Record<string, unknown> = {};
      const chain = (name: string) => (...args: unknown[]) => {
        if (name === "insert" || name === "update" || name === "delete" || name === "upsert") {
          op.verb = name;
          op.payload = args[0];
        }
        if (name === "eq" || name === "in" || name === "is" || name === "not") op.filters.push([`${name}:${String(args[0])}`, args[1]]);
        return builder;
      };
      for (const n of ["select", "insert", "update", "delete", "upsert", "eq", "in", "is", "not", "order", "limit"]) builder[n] = chain(n);
      const resolve = () => {
        if (!ops.includes(op)) ops.push(op);
        const key = `${table}.${op.verb}`;
        const r = responses[key];
        return typeof r === "function" ? (r as (op: Op) => unknown)(op) : (r ?? { data: [], error: null });
      };
      builder.maybeSingle = () => {
        const r = resolve() as { data: unknown[] | unknown; error: unknown };
        return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
      };
      builder.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, err);
      return builder;
    },
  };
  return { client: client as never, ops };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "t1", title: "Write the essay", mit_rank: 1, plan_area: "school", kill_list_item_id: null, planned_start_time: "09:00", planned_duration_minutes: 60,
  plan_order: 2, plan_criteria: "2 pages", plan_subdomain: null, created_at: "2026-10-10T10:00:00Z", due_date: "2026-10-10", ...over,
});

describe("carryOverCore", () => {
  it("does nothing, and reads nothing, for no ids", async () => {
    const f = fake();
    expect(await carryOverCore(f.client, "u", "2026-10-10", "2026-10-11", [])).toEqual({ lines: [] });
    expect(f.ops).toHaveLength(0);
  });

  it("moves unfinished rows to the next day and resets star, order, timer and Kill List pairing", async () => {
    const f = fake({ "tasks.select": { data: [row()], error: null } });
    const res = await carryOverCore(f.client, "u", "2026-10-10", "2026-10-11", ["t1"]);
    const move = f.ops.find((o) => o.verb === "update" && "planned_date" in (o.payload as object))!;
    expect(move.payload).toMatchObject({ planned_date: "2026-10-11", mit_rank: null, plan_order: null, kill_list_item_id: null, timer_started_at: null, timer_elapsed_seconds: 0 });
    expect(move.filters).toContainEqual(["eq:user_id", "u"]);
    expect(move.filters).toContainEqual(["eq:planned_date", "2026-10-10"]);
    expect(move.filters).toContainEqual(["eq:completed", false]);
    expect(res).toMatchObject({ lines: [{ id: "t1", starred: false, crowned: false, order: null, area: "school", startTime: "09:00", durationMinutes: 60, criteria: "2 pages" }] });
  });

  it("a School line's due date moves with it; other lines' due dates are untouched", async () => {
    const f = fake({ "tasks.select": { data: [row(), row({ id: "t2", plan_area: "body", due_date: null })], error: null } });
    await carryOverCore(f.client, "u", "2026-10-10", "2026-10-11", ["t1", "t2"]);
    const due = f.ops.filter((o) => o.verb === "update" && "due_date" in (o.payload as object));
    expect(due).toHaveLength(1);
    expect(due[0].payload).toEqual({ due_date: "2026-10-11" });
    expect(due[0].filters).toContainEqual(["in:id", ["t1"]]);
  });

  it("keeps the Kill List intent so Finish re-mirrors it into the new day", async () => {
    const f = fake({ "tasks.select": { data: [row({ plan_area: "business", kill_list_item_id: "k1", due_date: null })], error: null } });
    const res = await carryOverCore(f.client, "u", "2026-10-10", "2026-10-11", ["t1"]);
    expect(res).toMatchObject({ lines: [{ addToKillList: true }] });
  });

  it("reports a database error without claiming a move", async () => {
    const f = fake({ "tasks.select": { data: null, error: { message: "boom" } } });
    expect(await carryOverCore(f.client, "u", "2026-10-10", "2026-10-11", ["t1"])).toEqual({ error: "boom" });
  });
});
