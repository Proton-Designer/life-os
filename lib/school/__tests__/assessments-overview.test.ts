import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SOON_MAX_DAYS,
  UPCOMING_MAX_DAYS,
  buildAssessmentsOverview,
  countAssessmentsInNextTwoWeeks,
  daysBetweenDates,
  daysUntilLabel,
  getAssessmentsOverview,
  groupForDaysUntil,
} from "../assessments-overview";

const row = (over: Partial<Parameters<typeof buildAssessmentsOverview>[0][number]> = {}) => ({
  id: "a1", classId: "c1", className: "DSA", name: "Quiz", type: "quiz" as const, date: "2026-10-10", weightPct: null, taskId: null, ...over,
});

describe("grouping boundaries (one place)", () => {
  it("Soon 0-7, Upcoming 8-30, Future 31+", () => {
    expect([SOON_MAX_DAYS, UPCOMING_MAX_DAYS]).toEqual([7, 30]);
    expect([0, 7].map(groupForDaysUntil)).toEqual(["soon", "soon"]);
    expect([8, 30].map(groupForDaysUntil)).toEqual(["upcoming", "upcoming"]);
    expect([31, 200].map(groupForDaysUntil)).toEqual(["future", "future"]);
  });
  it("labels", () => {
    expect([0, 1, 5].map(daysUntilLabel)).toEqual(["Today", "Tomorrow", "In 5 days"]);
  });
});

describe("daysBetweenDates", () => {
  it("counts whole calendar days, across month ends and DST changes", () => {
    expect(daysBetweenDates("2026-10-04", "2026-10-04")).toBe(0);
    expect(daysBetweenDates("2026-10-04", "2026-10-11")).toBe(7);
    expect(daysBetweenDates("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysBetweenDates("2026-03-07", "2026-03-09")).toBe(2); // US spring-forward weekend
    expect(daysBetweenDates("2026-10-04", "2026-10-01")).toBe(-3);
  });
});

describe("buildAssessmentsOverview", () => {
  const today = "2026-10-04";
  it("groups by days until, drops past dates, sorts by date then class then name", () => {
    const out = buildAssessmentsOverview(
      [
        row({ id: "past", date: "2026-10-03" }),
        row({ id: "today", date: "2026-10-04" }),
        row({ id: "d7", date: "2026-10-11" }),
        row({ id: "d8", date: "2026-10-12" }),
        row({ id: "d30", date: "2026-11-03" }),
        row({ id: "d31", date: "2026-11-04" }),
        row({ id: "b", date: "2026-10-05", className: "B", name: "x" }),
        row({ id: "a", date: "2026-10-05", className: "A", name: "x" }),
      ],
      today
    );
    expect(out.soon.map((i) => i.id)).toEqual(["today", "a", "b", "d7"]);
    expect(out.upcoming.map((i) => i.id)).toEqual(["d8", "d30"]);
    expect(out.future.map((i) => i.id)).toEqual(["d31"]);
    expect(out.total).toBe(7);
    expect(out.soon[0].daysUntil).toBe(0);
  });
  it("reports a legacy final_midterm as exam, and carries the undated items apart", () => {
    const out = buildAssessmentsOverview([row({ type: "final_midterm" })], today, [{ id: "s1", classId: "c1", className: "DSA", name: "Final", type: "exam" }]);
    expect(out.soon[0].type).toBe("exam");
    expect(out.noDate).toHaveLength(1);
    expect(out.total).toBe(2);
  });
});

function fakeClient(tables: Record<string, unknown[]>) {
  const calls: Array<{ table: string; ops: Array<[string, ...unknown[]]> }> = [];
  const from = vi.fn((table: string) => {
    const rec = { table, ops: [] as Array<[string, ...unknown[]]> };
    calls.push(rec);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gte", "is", "order"]) chain[m] = vi.fn((...a: unknown[]) => (rec.ops.push([m, ...a]), chain));
    chain.then = (res: (v: { data: unknown[]; error: null }) => void) => res({ data: tables[table] ?? [], error: null });
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("getAssessmentsOverview", () => {
  it("reads only this user's rows dated >= today and joins class names (short_name else code)", async () => {
    const { client, calls } = fakeClient({
      classes: [{ id: "c1", short_name: "DSA", code: "CSCE 3110" }, { id: "c2", short_name: null, code: "MATH 2418" }],
      class_assessments: [
        { id: "a1", class_id: "c1", name: "Quiz 1", type: "quiz", date: "2026-10-06", weight_pct: 5, task_id: "t1" },
        { id: "a2", class_id: "c2", name: "Midterm 1", type: "final_midterm", date: "2026-12-01", weight_pct: null, task_id: null },
      ],
      staging_batches: [{ id: "b1", class_id: "c1" }],
      staged_deliverables: [{ id: "s1", batch_id: "b1", name: "Final exam", type: "final_midterm" }],
    });
    const out = await getAssessmentsOverview(client, "user-1", "2026-10-04");
    expect(out.soon.map((i) => [i.className, i.name, i.taskId])).toEqual([["DSA", "Quiz 1", "t1"]]);
    expect(out.future.map((i) => [i.className, i.type])).toEqual([["MATH 2418", "exam"]]);
    expect(out.noDate).toEqual([{ id: "s1", classId: "c1", className: "DSA", name: "Final exam", type: "exam" }]);
    const assess = calls.find((c) => c.table === "class_assessments")!;
    expect(assess.ops).toContainEqual(["eq", "user_id", "user-1"]);
    expect(assess.ops).toContainEqual(["gte", "date", "2026-10-04"]);
    for (const c of calls) expect(c.ops.some((o) => o[0] === "eq" && o[1] === "user_id" && o[2] === "user-1")).toBe(true);
  });
  it("no classes = empty overview and no further reads", async () => {
    const { client, calls } = fakeClient({ classes: [] });
    expect((await getAssessmentsOverview(client, "user-1", "2026-10-04")).total).toBe(0);
    expect(calls.map((c) => c.table)).toEqual(["classes"]);
  });
});

describe("countAssessmentsInNextTwoWeeks", () => {
  // 2026-10-07 is a Wednesday: the window is Sun 10-04 .. Sat 10-17 (current week + next week).
  const row = (id: string, date: string) => ({ id, classId: "c", className: "C", name: id, type: "quiz" as const, date, weightPct: null, taskId: null });
  it("counts this week and next week only, not later and not undated", () => {
    const o = buildAssessmentsOverview(
      [row("today", "2026-10-07"), row("sat-next", "2026-10-17"), row("sun-after", "2026-10-18"), row("far", "2026-12-01")],
      "2026-10-07",
      [{ id: "u", classId: "c", className: "C", name: "undated", type: "quiz" }]
    );
    expect(countAssessmentsInNextTwoWeeks(o, "2026-10-07")).toBe(2);
    expect(o.total).toBe(5);
  });
});
