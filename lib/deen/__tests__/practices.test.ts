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
    const ltFilters: Array<[string, unknown]> = [];
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (rec.eq.push([c, v]), q),
      in: (c: string, v: unknown[]) => (inFilters.push([c, v]), q),
      gte: (c: string, v: unknown) => (rec.gte.push([c, v]), q),
      lt: (c: string, v: unknown) => (ltFilters.push([c, v]), q),
      then: (resolve: (v: unknown) => void) => {
        const rows = tables[table].filter(
          (r) =>
            rec.eq.every(([c, v]) => r[c] === v) &&
            rec.gte.every(([c, v]) => String(r[c]) >= String(v)) &&
            inFilters.every(([c, v]) => v.includes(r[c])) &&
            ltFilters.every(([c, v]) => String(r[c]) < String(v))
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
    // a daily habit's adherence is exactly the original rolling rate (now also tagged with its unit)
    expect(p.rollingRate).toEqual({ ...computeHabitRollingRate({ id: "h1", name: "Dhikr after Fajr", committedDate: "2026-09-01" }, mapped, practiceWindowStart(TODAY), TODAY), unit: "day" });
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

describe("buildFaithPractices — cadence (HABIT-FREQ)", () => {
  // 2026-10-04 is a Sunday; the Sun-Sat week is 10-04..10-10.
  it("a habit that never set a cadence is daily and always due (every pre-existing row)", () => {
    const [p] = buildFaithPractices([habit()], [], TODAY);
    expect(p.frequency).toEqual({ kind: "daily" });
    expect(p.due.due).toBe(true);
    expect(p.due.statusText).toBeNull();
    expect(p.streakInfo.unit).toBe("day");
  });

  it("'3× a week': progress counts this week only, the row is due until the quota is met", () => {
    const row = habit({ frequency_type: "per_week", frequency_count: 3 });
    const [p] = buildFaithPractices([row], [log("h1", "2026-10-03"), log("h1", "2026-10-04")], "2026-10-06");
    expect(p.frequency).toEqual({ kind: "per_week", count: 3 });
    expect(p.due.progress).toEqual({ done: 1, target: 3, unit: "week" }); // 10-03 was LAST week
    expect(p.due.due).toBe(true);
    const [met] = buildFaithPractices([row], [log("h1", "2026-10-04"), log("h1", "2026-10-05"), log("h1", "2026-10-06")], "2026-10-07");
    expect(met.due.due).toBe(false);
    expect(met.due.statusText).toBe("Done for this week");
  });

  it("'Mon · Wed · Fri': not due on a Tuesday, streak unit is 'in a row', adherence only counts scheduled days", () => {
    const row = habit({ frequency_type: "weekdays", frequency_days: [1, 3, 5], committed_date: "2026-09-01" });
    const tue = buildFaithPractices([row], [log("h1", "2026-10-05")], "2026-10-06")[0]; // Monday done, today Tuesday
    expect(tue.due.due).toBe(false);
    expect(tue.due.statusText).toBe("Next: Wed");
    expect(tue.streakInfo.unit).toBe("in_a_row");
    expect(tue.rollingRate.unit).toBe("day");
  });

  it("a garbage / half-written cadence reads as daily instead of throwing", () => {
    const [p] = buildFaithPractices([habit({ frequency_type: "per_week", frequency_count: null })], [], TODAY);
    expect(p.frequency).toEqual({ kind: "daily" });
  });
});

describe("getFaithPractices — flexible habits get a longer log history", () => {
  const old = (id: string, date: string) => ({ habit_id: id, user_id: "u1", date, completed: true });
  const row = (over: Record<string, unknown>) => ({ ...habit(over), user_id: "u1", archived: false });

  it("a monthly habit's streak reaches back past the 60-day window; a daily habit still reads only 60 days", async () => {
    const tables = {
      deen_habits: [row({ id: "m", frequency_type: "per_month", frequency_count: 1, committed_date: "2025-01-01" }), row({ id: "d" })],
      deen_habit_logs: [
        // monthly: one completion in each of the last 5 months (well past 60 days)
        old("m", "2026-10-02"), old("m", "2026-09-10"), old("m", "2026-08-12"), old("m", "2026-07-08"), old("m", "2026-06-15"),
        // daily: an ancient completion that must NOT be read
        old("d", "2026-06-01"),
      ],
    };
    const practices = await getFaithPractices(fakeClient(tables).client, "u1", TODAY);
    const monthly = practices.find((p) => p.id === "m")!;
    expect(monthly.streakInfo).toEqual({ count: 5, unit: "month" });
    const daily = practices.find((p) => p.id === "d")!;
    expect(daily.streak).toBe(0);
  });

  it("makes no extra read when no habit is flexible", async () => {
    const { client, calls } = fakeClient({ deen_habits: [row({ id: "d" })], deen_habit_logs: [] });
    await getFaithPractices(client, "u1", TODAY);
    expect(calls.map((c) => c.table)).toEqual(["deen_habits", "deen_habit_logs"]); // habits + the standard log read, nothing more
  });
});
