import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFaithPractices, getFaithPractices, practiceLogsSince, practiceWindowStart } from "../practices";
import { computeHabitRollingRate } from "../habit-consistency";
import { computeHabitStreak } from "../habit-streak";

const TODAY = "2026-10-04";
const habit = (over: Record<string, unknown> = {}) => ({
  id: "h1",
  name: "Dhikr after Fajr",
  committed_date: "2026-09-01",
  anchor_cue: "After Fajr",
  stage_override: null as string | null,
  ...over,
});
const log = (habit_id: string, date: string, completed = true) => ({ habit_id, date, completed });

/** Minimal chainable client recording the filters each table read applied, so "archived excluded" and the window are really exercised. */
function fakeClient(tables: { deen_habits: Array<Record<string, unknown>>; deen_habit_logs: Array<Record<string, unknown>> }) {
  const calls: Array<{ table: string; eq: Array<[string, unknown]>; gte: Array<[string, unknown]> }> = [];
  const from = (table: "deen_habits" | "deen_habit_logs") => {
    const rec = { table, eq: [] as Array<[string, unknown]>, gte: [] as Array<[string, unknown]> };
    calls.push(rec);
    const inFilters: Array<[string, unknown[]]> = [];
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (rec.eq.push([c, v]), q),
      in: (c: string, v: unknown[]) => (inFilters.push([c, v]), q),
      gte: (c: string, v: unknown) => (rec.gte.push([c, v]), q),
      then: (resolve: (v: unknown) => void) => {
        const rows = tables[table].filter(
          (r) =>
            rec.eq.every(([c, v]) => r[c] === v) &&
            rec.gte.every(([c, v]) => String(r[c]) >= String(v)) &&
            inFilters.every(([c, v]) => v.includes(r[c]))
        );
        resolve({ data: rows, error: null });
      },
    };
    return q;
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("buildFaithPractices", () => {
  it("completedToday is by dateStr only", () => {
    const [p] = buildFaithPractices([habit()], [log("h1", "2026-10-03")], TODAY);
    expect(p.completedToday).toBe(false);
    const [q] = buildFaithPractices([habit()], [log("h1", "2026-10-04")], TODAY);
    expect(q.completedToday).toBe(true);
    const [r] = buildFaithPractices([habit()], [log("h1", "2026-10-04", false)], TODAY);
    expect(r.completedToday).toBe(false);
  });

  it("a manual stage override wins over the derived stage", () => {
    // committed 3 days ago: derived is active_build
    const young = { committed_date: "2026-10-01" };
    const derived = buildFaithPractices([habit(young)], [], TODAY)[0];
    expect(derived.stage).toBe("active_build");
    const pinned = buildFaithPractices([habit({ ...young, stage_override: "locked" })], [], TODAY)[0];
    expect(pinned.stage).toBe("locked");
    expect(pinned.stageOverride).toBe("locked");
  });

  it("rate and streak are exactly the Faith page's helpers over the same window", () => {
    const logs = [log("h1", "2026-10-04"), log("h1", "2026-10-03"), log("h1", "2026-10-01"), log("h1", "2026-09-20")];
    const [p] = buildFaithPractices([habit()], logs, TODAY);
    const mapped = logs.map((l) => ({ habitId: l.habit_id, date: l.date, completed: l.completed }));
    expect(p.rollingRate).toEqual(computeHabitRollingRate({ id: "h1", name: "Dhikr after Fajr", committedDate: "2026-09-01" }, mapped, practiceWindowStart(TODAY), TODAY));
    expect(p.streak).toBe(computeHabitStreak(["2026-10-04", "2026-10-03", "2026-10-01", "2026-09-20"], TODAY));
    expect(p.streak).toBe(2);
    expect(p.rollingRate.done).toBe(4);
  });

  it("only that habit's logs count", () => {
    const [a, b] = buildFaithPractices([habit(), habit({ id: "h2", name: "Other" })], [log("h2", "2026-10-04")], TODAY);
    expect(a.completedToday).toBe(false);
    expect(b.completedToday).toBe(true);
  });
});

describe("getFaithPractices", () => {
  it("excludes archived practices and reads logs only for the live ones within the window", async () => {
    const { client, calls } = fakeClient({
      deen_habits: [
        { ...habit(), user_id: "u1", archived: false },
        { ...habit({ id: "h-arch", name: "Old" }), user_id: "u1", archived: true },
        { ...habit({ id: "h-other", name: "Not mine" }), user_id: "u2", archived: false },
      ],
      deen_habit_logs: [
        { habit_id: "h1", user_id: "u1", date: "2026-10-04", completed: true },
        { habit_id: "h1", user_id: "u1", date: "2026-06-01", completed: true }, // outside the 60-day window
        { habit_id: "h-arch", user_id: "u1", date: "2026-10-04", completed: true },
      ],
    });
    const out = await getFaithPractices(client, "u1", TODAY);
    expect(out.map((p) => p.id)).toEqual(["h1"]);
    expect(out[0].completedToday).toBe(true);
    expect(out[0].streak).toBe(1);
    expect(calls.find((c) => c.table === "deen_habits")!.eq).toContainEqual(["archived", false]);
    expect(calls.find((c) => c.table === "deen_habit_logs")!.gte).toContainEqual(["date", practiceLogsSince(TODAY)]);
  });

  it("no practices means no log read", async () => {
    const { client, calls } = fakeClient({ deen_habits: [], deen_habit_logs: [] });
    expect(await getFaithPractices(client, "u1", TODAY)).toEqual([]);
    expect(calls.map((c) => c.table)).toEqual(["deen_habits"]);
  });
});
