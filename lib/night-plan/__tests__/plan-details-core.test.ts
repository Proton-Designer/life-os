import { describe, expect, it } from "vitest";
import { applyPlanDetailsCore, removePlanLinesCore, setPlanLineCompletedCore, startTaskTimerCore } from "../plan-details-core";
import type { PlanLineInput } from "../plan-details";

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

const DAY = "2026-10-07";
const line = (over: Partial<PlanLineInput> = {}): PlanLineInput => ({ id: "t1", area: null, addToKillList: false, startTime: null, durationMinutes: null, order: 0, ...over });
const prevRow = (over: Record<string, unknown> = {}) => ({ id: "t1", title: "Ship the deck", plan_area: null, domain: null, due_date: null, kill_list_item_id: null, ...over });

describe("applyPlanDetailsCore", () => {
  it("rejects a malformed line before touching the database", async () => {
    const f = fake();
    const res = await applyPlanDetailsCore(f.client, "u", DAY, [line({ startTime: "9am" })], { killListAvailable: true });
    expect(res).toEqual({ error: "Enter a valid time." });
    expect(f.ops).toHaveLength(0);
  });

  it("errors when a line is no longer on the plan day", async () => {
    const f = fake({ "tasks.select": { data: [], error: null } });
    const res = await applyPlanDetailsCore(f.client, "u", DAY, [line()], { killListAvailable: true });
    expect("error" in res).toBe(true);
  });

  it("writes timing, area and order on the row, scoped to the user and plan day", async () => {
    const f = fake({ "tasks.select": { data: [prevRow()], error: null } });
    const res = await applyPlanDetailsCore(f.client, "u", DAY, [line({ area: "body", startTime: "06:30", durationMinutes: 45, order: 3 })], { killListAvailable: true });
    expect(res).toEqual({ killListOverflow: [], notices: [] });
    const update = f.ops.find((o) => o.table === "tasks" && o.verb === "update")!;
    expect(update.payload).toMatchObject({ plan_area: "body", planned_start_time: "06:30", planned_duration_minutes: 45, plan_order: 3 });
    expect(update.filters).toEqual(expect.arrayContaining([["eq:user_id", "u"], ["eq:planned_date", DAY], ["eq:id", "t1"]]));
  });

  it("School becomes a School task for the day", async () => {
    const f = fake({ "tasks.select": { data: [prevRow()], error: null } });
    await applyPlanDetailsCore(f.client, "u", DAY, [line({ area: "school" })], { killListAvailable: true });
    expect(f.ops.find((o) => o.verb === "update")!.payload).toMatchObject({ domain: "school", due_date: DAY });
  });

  it("Business + Kill List mirrors the title into the list and pairs the row", async () => {
    // Two selects hit kill_list_items: before (free slots) and after (resolve ids). Return the placed row on the second.
    let call = 0;
    const responses = {
      "tasks.select": { data: [prevRow()], error: null },
      "kill_list_items.select": () => (++call === 1 ? { data: [], error: null } : { data: [{ id: "k9", text: "Ship the deck" }], error: null }),
      "kill_list_items.upsert": { data: null, error: null },
    };
    const g = fake(responses);
    const res = await applyPlanDetailsCore(g.client, "u", DAY, [line({ area: "business", addToKillList: true })], { killListAvailable: true });
    expect(res).toEqual({ killListOverflow: [], notices: [] });
    expect(g.ops.find((o) => o.table === "kill_list_items" && o.verb === "upsert")!.payload).toMatchObject({ date: DAY, position: 0, text: "Ship the deck" });
    expect(g.ops.find((o) => o.table === "tasks" && o.verb === "update")!.payload).toMatchObject({ plan_area: "business", kill_list_item_id: "k9" });
  });

  it("a full Kill List reports the overflow and still saves the line as a Business task", async () => {
    let call = 0;
    const full = [0, 1, 2].map((position) => ({ position, text: `T${position}`, id: `k${position}` }));
    const f = fake({
      "tasks.select": { data: [prevRow()], error: null },
      "kill_list_items.select": () => (++call === 1 ? { data: full, error: null } : { data: full, error: null }),
    });
    const res = await applyPlanDetailsCore(f.client, "u", DAY, [line({ area: "business", addToKillList: true })], { killListAvailable: true });
    expect(res).toEqual({ killListOverflow: ["Ship the deck"], notices: [] });
    const update = f.ops.find((o) => o.table === "tasks" && o.verb === "update")!;
    expect(update.payload).toMatchObject({ plan_area: "business" });
    expect((update.payload as Record<string, unknown>).kill_list_item_id).toBeUndefined();
  });

  it("an account with no Kill List never writes one", async () => {
    const f = fake({ "tasks.select": { data: [prevRow()], error: null } });
    await applyPlanDetailsCore(f.client, "u", DAY, [line({ area: "business", addToKillList: true })], { killListAvailable: false });
    expect(f.ops.some((o) => o.table === "kill_list_items")).toBe(false);
  });

  it("unchecking the Kill List removes the open row it created and unpairs", async () => {
    const f = fake({ "tasks.select": { data: [prevRow({ plan_area: "business", kill_list_item_id: "k1" })], error: null } });
    await applyPlanDetailsCore(f.client, "u", DAY, [line({ area: "business", addToKillList: false })], { killListAvailable: true });
    const del = f.ops.find((o) => o.table === "kill_list_items" && o.verb === "delete")!;
    expect(del.filters).toEqual(expect.arrayContaining([["in:id", ["k1"]], ["eq:completed", false]]));
    expect(f.ops.find((o) => o.table === "tasks" && o.verb === "update")!.payload).toMatchObject({ kill_list_item_id: null });
  });

  it("entering Work adds a Backlog task under the current target, once", async () => {
    const f = fake({ "tasks.select": { data: [prevRow()], error: null }, "coop_targets.select": { data: [{ id: "tg1" }], error: null } });
    await applyPlanDetailsCore(f.client, "u", DAY, [line({ area: "work" })], { killListAvailable: true });
    expect(f.ops.find((o) => o.table === "coop_tasks" && o.verb === "insert")!.payload).toEqual([{ user_id: "u", target_id: "tg1", title: "Ship the deck", status: "backlog" }]);

    const again = fake({ "tasks.select": { data: [prevRow({ plan_area: "work" })], error: null } });
    await applyPlanDetailsCore(again.client, "u", DAY, [line({ area: "work" })], { killListAvailable: true });
    expect(again.ops.some((o) => o.table === "coop_tasks")).toBe(false);
  });

  it("Work with no active target keeps the line on the plan and says so", async () => {
    const f = fake({ "tasks.select": { data: [prevRow()], error: null }, "coop_targets.select": { data: [], error: null } });
    const res = await applyPlanDetailsCore(f.client, "u", DAY, [line({ area: "work" })], { killListAvailable: true });
    expect(res).toMatchObject({ notices: [expect.stringContaining("no active Work target")] });
    expect(f.ops.some((o) => o.table === "coop_tasks")).toBe(false);
  });
});

describe("removePlanLinesCore", () => {
  it("deletes a typed line, but only un-plans a worry or a capture", async () => {
    const f = fake({
      "tasks.select": {
        data: [
          { id: "a", dump_source: "note", plan_area: null, kill_list_item_id: null },
          { id: "w", dump_source: "worry", plan_area: "school", kill_list_item_id: null },
        ],
        error: null,
      },
    });
    const res = await removePlanLinesCore(f.client, "u", DAY, ["a", "w"]);
    expect(res).toEqual({ ok: true });
    const del = f.ops.find((o) => o.table === "tasks" && o.verb === "delete")!;
    expect(del.filters).toEqual(expect.arrayContaining([["in:id", ["a"]]]));
    const updates = f.ops.filter((o) => o.table === "tasks" && o.verb === "update");
    expect(updates[0]!.payload).toMatchObject({ planned_date: null, mit_rank: null, plan_area: null });
    expect(updates[0]!.filters).toEqual(expect.arrayContaining([["in:id", ["w"]]]));
    expect(updates[1]!.payload).toEqual({ domain: null, due_date: null }); // a School-attached worry stops being a School task
  });

  it("takes an open paired Kill List row with the line", async () => {
    const f = fake({ "tasks.select": { data: [{ id: "a", dump_source: "note", plan_area: "business", kill_list_item_id: "k1" }], error: null } });
    await removePlanLinesCore(f.client, "u", DAY, ["a"]);
    const del = f.ops.find((o) => o.table === "kill_list_items" && o.verb === "delete")!;
    expect(del.filters).toEqual(expect.arrayContaining([["in:id", ["k1"]], ["eq:completed", false]]));
  });

  it("does nothing for no ids", async () => {
    const f = fake();
    expect(await removePlanLinesCore(f.client, "u", DAY, [])).toEqual({ ok: true });
    expect(f.ops).toHaveLength(0);
  });
});

describe("timers and completion", () => {
  it("starting a running timer keeps the original start (idempotent)", async () => {
    const f = fake({ "tasks.select": { data: [{ timer_started_at: "2026-10-07T10:00:00.000Z" }], error: null } });
    const res = await startTaskTimerCore(f.client, "u", "t1", new Date("2026-10-07T11:00:00Z"));
    expect(res.startedAt).toBe("2026-10-07T10:00:00.000Z");
    expect(f.ops.some((o) => o.verb === "update")).toBe(false);
  });

  it("starting a fresh timer stamps now", async () => {
    const f = fake({ "tasks.select": { data: [{ timer_started_at: null }], error: null } });
    const res = await startTaskTimerCore(f.client, "u", "t1", new Date("2026-10-07T11:00:00Z"));
    expect(res.startedAt).toBe("2026-10-07T11:00:00.000Z");
    expect(f.ops.find((o) => o.verb === "update")!.payload).toEqual({ timer_started_at: "2026-10-07T11:00:00.000Z" });
  });

  it("completing a plan line also completes its paired Kill List row, and stops its timer", async () => {
    const f = fake({ "tasks.update": { data: [{ id: "t1", kill_list_item_id: "k1" }], error: null } });
    await setPlanLineCompletedCore(f.client, "u", "t1", true, new Date("2026-10-07T11:00:00Z"));
    expect(f.ops.find((o) => o.table === "tasks" && o.verb === "update")!.payload).toMatchObject({ completed: true, timer_started_at: null });
    const k = f.ops.find((o) => o.table === "kill_list_items" && o.verb === "update")!;
    expect(k.payload).toEqual({ completed: true, completed_at: "2026-10-07T11:00:00.000Z" });
    expect(k.filters).toEqual(expect.arrayContaining([["eq:id", "k1"]]));
  });

  it("an unpaired line touches no Kill List row; a missing task throws", async () => {
    const f = fake({ "tasks.update": { data: [{ id: "t1", kill_list_item_id: null }], error: null } });
    await setPlanLineCompletedCore(f.client, "u", "t1", false, new Date());
    expect(f.ops.some((o) => o.table === "kill_list_items")).toBe(false);
    const none = fake({ "tasks.update": { data: [], error: null } });
    await expect(setPlanLineCompletedCore(none.client, "u", "zzz", true, new Date())).rejects.toThrow("Task not found");
  });
});
