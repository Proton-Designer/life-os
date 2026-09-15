import { describe, it, expect, vi } from "vitest";
import { getClassCards } from "../get-class-cards";

type Row = Record<string, unknown>;

function makeSelectResult(rows: Row[]) {
  // A thenable chain that supports .eq/.in/.gte/.lte/.neq/.is/.order in any order,
  // resolving to { data: rows, error: null } — mirrors the real
  // supabase-js query builder's own thenable shape closely enough for this
  // pure data-shaping function, which only ever awaits the final result.
  const chain: Record<string, unknown> = {};
  // `.returns<T>()` is a type-only override in the real supabase-js client — it returns
  // `this` and changes nothing at runtime, so the fake mirrors that rather than needing
  // its own case per call site.
  for (const method of ["select", "eq", "in", "gte", "lte", "neq", "is", "order", "returns"]) {
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
    category_id: null,
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
      classes: [{ id: "c1", short_name: "DSA", code: "CS-3345-HON", room: "FO 2.404", instructor: "Nemec", syllabus_path: "u/c1/x.pdf", difficulty_rating: null, confidence_rating: null, target_grade_pct: null, term: null, late_policy: null, attendance_policy: null, allowed_absences: null, grade_boundaries: null }],
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
        term: null,
        latePolicy: null,
        attendancePolicy: null,
        allowedAbsences: null,
        gradeBoundaries: [],
        difficultyRating: null,
        targetGradePct: null,
        hasSyllabus: true,
        tasksDueThisWeek: 2, // t1 + t2 fall within the 2026-08-24 week; t3 doesn't
        upcomingAssessment: { name: "Quiz 2", date: "2026-09-10" }, // nearest, not just first
        assessments: [
          { id: "a1", name: "Quiz 2", type: "quiz", date: "2026-09-10", taskId: null, weightPct: null, pointsEarned: null, pointsPossible: null, isExcused: false, categoryId: null },
          { id: "a2", name: "Quiz 3", type: "quiz", date: "2026-09-20", taskId: null, weightPct: null, pointsEarned: null, pointsPossible: null, isExcused: false, categoryId: null },
        ],
        categories: [],
        tasks: [
          { id: "t1", title: "Task t1", dueDate: "2026-08-25", taskType: "homework_assignment", taskTypeOtherLabel: null, classId: "c1" },
          { id: "t2", title: "Task t2", dueDate: "2026-08-26", taskType: "homework_assignment", taskTypeOtherLabel: null, classId: "c1" },
          { id: "t3", title: "Task t3", dueDate: "2026-09-15", taskType: "homework_assignment", taskTypeOtherLabel: null, classId: "c1" },
        ],
        questions: [],
        pendingStagingBatch: null,
        lectures: [],
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
      classes: [{ id: "c2", short_name: "Lin Alg", code: "MATH 2418", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null, term: null, late_policy: null, attendance_policy: null, allowed_absences: null, grade_boundaries: null }],
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
        term: null,
        latePolicy: null,
        attendancePolicy: null,
        allowedAbsences: null,
        gradeBoundaries: [],
        difficultyRating: null,
        targetGradePct: null,
        hasSyllabus: false,
        tasksDueThisWeek: 0,
        upcomingAssessment: null,
        assessments: [],
        categories: [],
        tasks: [],
        questions: [],
        pendingStagingBatch: null,
        lectures: [],
      },
    ]);
  });

  it("shapes a class's question bank (Phase 1 #20) into camelCase rows, active and retired alike", async () => {
    const supabase = makeFakeSupabase({
      classes: [{ id: "c1", short_name: "DSA", code: "CS-3345-HON", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null, term: null, late_policy: null, attendance_policy: null, allowed_absences: null, grade_boundaries: null }],
      tasks: [],
      class_assessments: [],
      questions: [
        { id: "q1", class_id: "c1", prompt: "What is Big-O of binary search?", answer: "O(log n)", topic: "Complexity", source_anchor: "Ch. 3, p.42", source_skipped: false, origin: "self", active: true },
        { id: "q2", class_id: "c1", prompt: "Define a heap invariant", answer: "Parent <= children (min-heap)", topic: null, source_anchor: null, source_skipped: true, origin: "missed", active: false },
      ],
    });

    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");

    expect(result[0]!.questions).toEqual([
      { id: "q1", prompt: "What is Big-O of binary search?", answer: "O(log n)", topic: "Complexity", sourceAnchor: "Ch. 3, p.42", sourceSkipped: false, origin: "self", active: true },
      { id: "q2", prompt: "Define a heap invariant", answer: "Parent <= children (min-heap)", topic: null, sourceAnchor: null, sourceSkipped: true, origin: "missed", active: false },
    ]);
  });

  // P3-14 — mirrors the questions-bank test above: camelCase shaping, grouped
  // by class_id, most-recent-first order trusted from the real query same as
  // pendingStagingBatch's own fixtures.
  it("shapes a class's lecture recordings into camelCase rows", async () => {
    const supabase = makeFakeSupabase({
      classes: [{ id: "c1", short_name: "DSA", code: "CS-3345-HON", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null, term: null, late_policy: null, attendance_policy: null, allowed_absences: null, grade_boundaries: null }],
      tasks: [],
      class_assessments: [],
      lecture_recordings: [
        { id: "l2", class_id: "c1", original_filename: "lec2.m4a", mime_type: "audio/x-m4a", size_bytes: 2048, duration_seconds: null, created_at: "2026-09-10T00:00:00Z" },
        { id: "l1", class_id: "c1", original_filename: "lec1.mp3", mime_type: "audio/mpeg", size_bytes: 1024, duration_seconds: 1800, created_at: "2026-09-01T00:00:00Z" },
      ],
    });

    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");

    expect(result[0]!.lectures).toEqual([
      { id: "l2", originalFilename: "lec2.m4a", mimeType: "audio/x-m4a", sizeBytes: 2048, durationSeconds: null, createdAt: "2026-09-10T00:00:00Z" },
      { id: "l1", originalFilename: "lec1.mp3", mimeType: "audio/mpeg", sizeBytes: 1024, durationSeconds: 1800, createdAt: "2026-09-01T00:00:00Z" },
    ]);
  });

  it("never attributes another class's lecture recordings to a class with none of its own", async () => {
    const supabase = makeFakeSupabase({
      classes: [
        { id: "c1", short_name: "DSA", code: "CS-3345-HON", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null, term: null, late_policy: null, attendance_policy: null, allowed_absences: null, grade_boundaries: null },
        { id: "c2", short_name: "Phys", code: "PHYS-2326-002", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null, term: null, late_policy: null, attendance_policy: null, allowed_absences: null, grade_boundaries: null },
      ],
      tasks: [],
      class_assessments: [],
      lecture_recordings: [
        { id: "l1", class_id: "c1", original_filename: "lec1.mp3", mime_type: "audio/mpeg", size_bytes: 1024, duration_seconds: null, created_at: "2026-09-01T00:00:00Z" },
      ],
    });

    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
    const c2 = result.find((r) => r.id === "c2")!;
    expect(c2.lectures).toEqual([]);
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
        { id: "c1", short_name: "DSA", code: "CS-3345-HON", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null, term: null, late_policy: null, attendance_policy: null, allowed_absences: null, grade_boundaries: null },
        { id: "c2", short_name: "Phys", code: "PHYS-2326-002", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null, term: null, late_policy: null, attendance_policy: null, allowed_absences: null, grade_boundaries: null },
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
      classes: [{ id: "c1", short_name: "DSA", code: "CS-3345-HON", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null, term: null, late_policy: null, attendance_policy: null, allowed_absences: null, grade_boundaries: null }],
      tasks: [task("t1", "c1", "2026-08-25"), task("t2", "c1", "2026-10-01")],
      class_assessments: [],
    });

    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
    expect(result[0].tasksDueThisWeek).toBe(1);
    expect(result[0].tasks).toHaveLength(2);
  });

  it("carries weight/points/excused through unchanged, neither defaulted nor coalesced", async () => {
    const supabase = makeFakeSupabase({
      classes: [{ id: "c1", short_name: "DSA", code: "CS-3345-HON", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null, term: null, late_policy: null, attendance_policy: null, allowed_absences: null, grade_boundaries: null }],
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
      classes: [{ id: "c1", short_name: "DSA", code: "CS-3345-HON", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null, term: null, late_policy: null, attendance_policy: null, allowed_absences: null, grade_boundaries: null }],
      tasks: [],
      class_assessments: [assessment("a1", "c1", "Past Quiz", "2026-08-01"), assessment("a2", "c1", "Future Quiz", "2026-09-01")],
    });

    const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
    expect(result[0].upcomingAssessment).toEqual({ name: "Future Quiz", date: "2026-09-01" });
    expect(result[0].assessments).toHaveLength(2);
  });

  // Phase 1 #16/#18 — the syllabus-extraction review surface.
  describe("pendingStagingBatch", () => {
    function classRow(id: string) {
      return { id, short_name: "DSA", code: "CS-3345-HON", room: null, instructor: null, syllabus_path: null, difficulty_rating: null, confidence_rating: null, target_grade_pct: null, term: null, late_policy: null, attendance_policy: null, allowed_absences: null, grade_boundaries: null };
    }

    it("is null when a class has never had a batch", async () => {
      const supabase = makeFakeSupabase({ classes: [classRow("c1")], tasks: [], class_assessments: [] });
      const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
      expect(result[0]!.pendingStagingBatch).toBeNull();
    });

    it("surfaces a pending batch with its uncommitted deliverables", async () => {
      const supabase = makeFakeSupabase({
        classes: [classRow("c1")],
        tasks: [],
        class_assessments: [],
        staging_batches: [{ id: "b1", class_id: "c1", status: "pending", created_at: "2026-08-20T00:00:00Z" }],
        staged_deliverables: [
          { id: "d1", batch_id: "b1", name: "Midterm", type: "exam", date: "2026-10-01", confidence: 0.9, source_snippet: "Midterm: Oct 1", committed_assessment_id: null },
        ],
      });
      const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
      expect(result[0]!.pendingStagingBatch).toEqual({
        id: "b1",
        deliverables: [{ id: "d1", name: "Midterm", type: "exam", date: "2026-10-01", confidence: 0.9, sourceSnippet: "Midterm: Oct 1" }],
      });
    });

    // The real query's own `.neq("status", "confirmed")` filters a confirmed batch out
    // before this function ever sees it (this mock, like the rest of this file, trusts
    // the fixture is already what a real filtered query would return) — so a class with
    // ONLY a confirmed batch reaches this function with an empty staging_batches result,
    // exactly like a class that never had a batch at all.
    it("is null when the only batch is confirmed — nothing left to review", async () => {
      const supabase = makeFakeSupabase({
        classes: [classRow("c1")],
        tasks: [],
        class_assessments: [],
        staging_batches: [],
        staged_deliverables: [],
      });
      const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
      expect(result[0]!.pendingStagingBatch).toBeNull();
    });

    it("surfaces a genuinely empty batch (#19's 'nothing schedulable found') as a real batch with zero deliverables, not null", async () => {
      const supabase = makeFakeSupabase({
        classes: [classRow("c1")],
        tasks: [],
        class_assessments: [],
        staging_batches: [{ id: "b1", class_id: "c1", status: "pending", created_at: "2026-08-20T00:00:00Z" }],
        staged_deliverables: [],
      });
      const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
      expect(result[0]!.pendingStagingBatch).toEqual({ id: "b1", deliverables: [] });
    });

    it("picks only the MOST RECENT pending batch when a class somehow has more than one", async () => {
      const supabase = makeFakeSupabase({
        classes: [classRow("c1")],
        tasks: [],
        class_assessments: [],
        // Newest first — matches what the real query's own .order("created_at", {
        // ascending: false }) would return (this mock, like the rest of this file,
        // trusts the fixture is already ordered/filtered the way a real query would).
        staging_batches: [
          { id: "newer", class_id: "c1", status: "pending", created_at: "2026-08-20T00:00:00Z" },
          { id: "older", class_id: "c1", status: "pending", created_at: "2026-08-01T00:00:00Z" },
        ],
        staged_deliverables: [
          { id: "d-older", batch_id: "older", name: "Old", type: "quiz", date: null, confidence: 0.5, source_snippet: null, committed_assessment_id: null },
          { id: "d-newer", batch_id: "newer", name: "New", type: "quiz", date: null, confidence: 0.5, source_snippet: null, committed_assessment_id: null },
        ],
      });
      const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
      expect(result[0]!.pendingStagingBatch!.id).toBe("newer");
      expect(result[0]!.pendingStagingBatch!.deliverables.map((d) => d.id)).toEqual(["d-newer"]);
    });

    it("never attributes another class's batch or deliverables to a class with none of its own", async () => {
      const supabase = makeFakeSupabase({
        classes: [classRow("c1"), { ...classRow("c2"), id: "c2" }],
        tasks: [],
        class_assessments: [],
        staging_batches: [{ id: "b1", class_id: "c1", status: "pending", created_at: "2026-08-20T00:00:00Z" }],
        staged_deliverables: [{ id: "d1", batch_id: "b1", name: "Midterm", type: "exam", date: null, confidence: 0.5, source_snippet: null, committed_assessment_id: null }],
      });
      const result = await getClassCards(supabase as never, "user-1", "2026-08-24", "2026-08-26");
      const c2 = result.find((r) => r.id === "c2")!;
      expect(c2.pendingStagingBatch).toBeNull();
    });
  });
});
