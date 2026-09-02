import { describe, it, expect, vi } from "vitest";
import { getClassCards } from "../get-class-cards";

type Row = Record<string, unknown>;

function makeSelectResult(rows: Row[]) {
  // A thenable chain that supports .eq/.in/.gte/.lte/.order in any order,
  // resolving to { data: rows, error: null } — mirrors the real
  // supabase-js query builder's own thenable shape closely enough for this
  // pure data-shaping function, which only ever awaits the final result.
  const chain: Record<string, unknown> = {};
  // `.returns<T>()` is a type-only override in the real supabase-js client — it returns
  // `this` and changes nothing at runtime, so the fake mirrors that rather than needing
  // its own case per call site.
  for (const method of ["select", "eq", "in", "gte", "lte", "order", "returns"]) {
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

function task(id: string, classId: string, dueDate: string, overrides: Row = {}): Row {
  return {
    id,
    class_id: classId,
    title: `Task ${id}`,
    due_date: dueDate,
    task_type: "homework_assignment",
    task_type_other_label: null,
    ...overrides,
  };
}

function assessment(id: string, classId: string, name: string, date: string, overrides: Row = {}): Row {
  return {
    id,
    class_id: classId,
    name,
    type: "quiz",
    date,
    task_id: null,
    weight_pct: null,
    points_earned: null,
    points_possible: null,
    is_excused: false,
    ...overrides,
  };
}

// This suite is about data SHAPING (grouping, this-week filtering, nearest-upcoming
// selection) — the risk SCORE's exact value is the risk engine's own contract, covered
// exhaustively in lib/school/risk/__tests__. Stripping it here keeps this suite from
// having to hand-duplicate that math, while still asserting the field exists and looks
// like a real risk result (see the shape check below each toEqual).
function stripRisk<T extends { assessments: { risk: unknown }[] }>(classCard: T) {
  return { ...classCard, assessments: classCard.assessments.map(({ risk, ...rest }) => rest) };
}

function expectRealRiskResult(assessments: { risk: { score: number; band: string } }[]) {
  for (const a of assessments) {
    expect(Number.isFinite(a.risk.score)).toBe(true);
    expect(["low", "moderate", "high", "critical"]).toContain(a.risk.band);
  }
}

describe("getClassCards", () => {
  it("shapes a normal class: this-week task count derived from the full task list, nearest upcoming assessment, full arrays carried through", async () => {
    const supabase = makeFakeSupabase({
      classes: [{ id: "c1", short_name: "DSA", code: "CS-3345-HON", room: "FO 2.404", instructor: "Nemec", syllabus_path: "u/c1/x.pdf", difficulty_rating: null, confidence_rating: null, target_grade_pct: null }],
      tasks: [task("t1", "c1", "2026-08-25"), task("t2", "c1", "2026-08-26"), task("t3", "c1", "2026-09-15")],
      class_assessments: [assessment("a1", "c1", "Quiz 2", "2026-09-10"), assessment("a2", "c1", "Quiz 3", "2026-09-20")],
    });

    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");

    expectRealRiskResult(result[0]!.assessments);
    expect(result.map(stripRisk)).toEqual([
      {
        id: "c1",
        shortName: "DSA",
        code: "CS-3345-HON",
        room: "FO 2.404",
        instructor: "Nemec",
        difficultyRating: null,
        hasSyllabus: true,
        tasksDueThisWeek: 2, // t1 + t2 fall within the 2026-08-24 week; t3 doesn't
        upcomingAssessment: { name: "Quiz 2", date: "2026-09-10" }, // nearest, not just first
        assessments: [
          { id: "a1", name: "Quiz 2", type: "quiz", date: "2026-09-10", taskId: null, weightPct: null, pointsEarned: null, pointsPossible: null, isExcused: false },
          { id: "a2", name: "Quiz 3", type: "quiz", date: "2026-09-20", taskId: null, weightPct: null, pointsEarned: null, pointsPossible: null, isExcused: false },
        ],
        tasks: [
          { id: "t1", title: "Task t1", dueDate: "2026-08-25", taskType: "homework_assignment", taskTypeOtherLabel: null, classId: "c1" },
          { id: "t2", title: "Task t2", dueDate: "2026-08-26", taskType: "homework_assignment", taskTypeOtherLabel: null, classId: "c1" },
          { id: "t3", title: "Task t3", dueDate: "2026-09-15", taskType: "homework_assignment", taskTypeOtherLabel: null, classId: "c1" },
        ],
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
      classes: [{ id: "c2", short_name: "Lin Alg", code: "MATH 2418", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null }],
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
        difficultyRating: null,
        hasSyllabus: false,
        tasksDueThisWeek: 0,
        upcomingAssessment: null,
        assessments: [],
        tasks: [],
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
        { id: "c1", short_name: "DSA", code: "CS-3345-HON", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null },
        { id: "c2", short_name: "Phys", code: "PHYS-2326-002", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null },
      ],
      tasks: [task("t1", "c1", "2026-08-25")],
      class_assessments: [assessment("a1", "c1", "Exam 1", "2026-09-01")],
    });

    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
    const c2 = result.find((r) => r.id === "c2")!;
    expect(c2.tasksDueThisWeek).toBe(0);
    expect(c2.upcomingAssessment).toBeNull();
    expect(c2.assessments).toEqual([]);
    expect(c2.tasks).toEqual([]);
  });

  it("keeps a class's full incomplete task list even for tasks outside this week — not just the this-week count", async () => {
    const supabase = makeFakeSupabase({
      classes: [{ id: "c1", short_name: "DSA", code: "CS-3345-HON", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null }],
      tasks: [task("t1", "c1", "2026-08-25"), task("t2", "c1", "2026-10-01")],
      class_assessments: [],
    });

    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
    expect(result[0].tasksDueThisWeek).toBe(1);
    expect(result[0].tasks).toHaveLength(2);
  });

  it("carries weight/points/excused through unchanged, neither defaulted nor coalesced", async () => {
    const supabase = makeFakeSupabase({
      classes: [{ id: "c1", short_name: "DSA", code: "CS-3345-HON", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null }],
      tasks: [],
      class_assessments: [
        assessment("a1", "c1", "Midterm", "2026-09-10", { weight_pct: 20, points_earned: 45, points_possible: 50, is_excused: false }),
        assessment("a2", "c1", "Excused Quiz", "2026-09-01", { weight_pct: 5, points_earned: null, points_possible: null, is_excused: true }),
        assessment("a3", "c1", "Not Yet Graded", "2026-09-20", { weight_pct: 10 }),
      ],
    });

    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
    const byId = new Map(result[0]!.assessments.map((a) => [a.id, a]));

    expect(byId.get("a1")).toMatchObject({ weightPct: 20, pointsEarned: 45, pointsPossible: 50, isExcused: false });
    expect(byId.get("a2")).toMatchObject({ weightPct: 5, pointsEarned: null, pointsPossible: null, isExcused: true });
    expect(byId.get("a3")).toMatchObject({ weightPct: 10, pointsEarned: null, pointsPossible: null, isExcused: false });
  });

  it("ignores a past assessment when picking the nearest upcoming one, but still carries it in the full array", async () => {
    const supabase = makeFakeSupabase({
      classes: [{ id: "c1", short_name: "DSA", code: "CS-3345-HON", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null }],
      tasks: [],
      class_assessments: [assessment("a1", "c1", "Past Quiz", "2026-08-01"), assessment("a2", "c1", "Future Quiz", "2026-09-01")],
    });

    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
    expect(result[0].upcomingAssessment).toEqual({ name: "Future Quiz", date: "2026-09-01" });
    expect(result[0].assessments).toHaveLength(2);
  });
});
