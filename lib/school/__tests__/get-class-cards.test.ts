import { describe, it, expect, vi } from "vitest";
import { getClassCards } from "../get-class-cards";

type Row = Record<string, unknown>;

function makeSelectResult(rows: Row[]) {
  // A thenable chain that supports .eq/.in/.gte/.lte/.order in any order,
  // resolving to { data: rows, error: null } — mirrors the real
  // supabase-js query builder's own thenable shape closely enough for this
  // pure data-shaping function, which only ever awaits the final result.
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "gte", "lte", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows, error: null });
  return chain;
}

function makeFakeSupabase(tables: Record<string, Row[]>) {
  return {
    from: vi.fn((table: string) => makeSelectResult(tables[table] ?? [])),
  };
}

describe("getClassCards", () => {
  it("shapes a normal class: task count from this week's incomplete tasks, nearest upcoming assessment", async () => {
    const supabase = makeFakeSupabase({
      classes: [{ id: "c1", short_name: "DSA", code: "CS-3345-HON", room: "FO 2.404", instructor: "Nemec", syllabus_path: "u/c1/x.pdf" }],
      tasks: [{ class_id: "c1" }, { class_id: "c1" }],
      class_assessments: [
        { class_id: "c1", name: "Quiz 2", date: "2026-09-10" },
        { class_id: "c1", name: "Quiz 3", date: "2026-09-20" },
      ],
    });

    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");

    expect(result).toEqual([
      {
        id: "c1",
        shortName: "DSA",
        code: "CS-3345-HON",
        room: "FO 2.404",
        instructor: "Nemec",
        hasSyllabus: true,
        tasksDueThisWeek: 2,
        upcomingAssessment: { name: "Quiz 2", date: "2026-09-10" }, // nearest, not just first
      },
    ]);
  });

  // The real null-path case (Opus Lead review): Lin Alg (MATH 2418) has no
  // linked schedule_events, null room/instructor, zero tasks, zero
  // assessments — every class added through a future editor before its
  // details are filled in hits this identical shape. Must render sanely,
  // not crash and not show "undefined".
  it("shapes a class with nothing else attached to it (the Lin Alg / MATH 2418 shape) without crashing or producing undefined", async () => {
    const supabase = makeFakeSupabase({
      classes: [{ id: "c2", short_name: "Lin Alg", code: "MATH 2418", room: null, instructor: null, syllabus_path: null }],
      tasks: [],
      class_assessments: [],
    });

    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");

    expect(result).toEqual([
      {
        id: "c2",
        shortName: "Lin Alg",
        code: "MATH 2418",
        room: null,
        instructor: null,
        hasSyllabus: false,
        tasksDueThisWeek: 0,
        upcomingAssessment: null,
      },
    ]);
  });

  it("returns an empty array with zero classes, without querying tasks/assessments at all", async () => {
    const supabase = makeFakeSupabase({ classes: [] });
    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
    expect(result).toEqual([]);
    // Only the classes table was ever queried — no wasted round trips for a user with no classes.
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith("classes");
  });

  it("never attributes another class's task count or assessment to a class with none of its own", async () => {
    const supabase = makeFakeSupabase({
      classes: [
        { id: "c1", short_name: "DSA", code: "CS-3345-HON", room: null, instructor: null, syllabus_path: null },
        { id: "c2", short_name: "Phys", code: "PHYS-2326-002", room: null, instructor: null, syllabus_path: null },
      ],
      tasks: [{ class_id: "c1" }],
      class_assessments: [{ class_id: "c1", name: "Exam 1", date: "2026-09-01" }],
    });

    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
    const c2 = result.find((r) => r.id === "c2")!;
    expect(c2.tasksDueThisWeek).toBe(0);
    expect(c2.upcomingAssessment).toBeNull();
  });
});
