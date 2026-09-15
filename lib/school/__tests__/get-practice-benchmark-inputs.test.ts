import { describe, it, expect, vi } from "vitest";
import { getPracticeBenchmarkInputs } from "../get-practice-benchmark-inputs";

type Row = Record<string, unknown>;
type Call = { method: string; args: unknown[] };

function makeSelectResult(rows: Row[], calls: Call[]) {
  const chain: Record<string, unknown> = {};
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  for (const method of ["select", "eq", "in", "not"]) chain[method] = vi.fn(record(method));
  chain.then = (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows, error: null });
  return chain;
}

function makeFakeSupabase(tables: Record<string, Row[]>) {
  const calls: Record<string, Call[]> = {};
  const client = {
    from: vi.fn((table: string) => {
      calls[table] ??= [];
      return makeSelectResult(tables[table] ?? [], calls[table]!);
    }),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
  return { client, calls };
}

describe("getPracticeBenchmarkInputs (P3-12)", () => {
  it("returns [] without querying assessments or practice tests when the user has no classes", async () => {
    const { client } = makeFakeSupabase({ classes: [] });
    const result = await getPracticeBenchmarkInputs(client, "user-1");
    expect(result).toEqual([]);
    expect((client.from as ReturnType<typeof vi.fn>)).not.toHaveBeenCalledWith("class_assessments");
  });

  it("queries class_assessments scoped to points_earned IS NOT NULL -- the same 'graded' rule P2-10/P2-21 already established", async () => {
    const { client, calls } = makeFakeSupabase({ classes: [{ id: "c1", short_name: "Calc II", code: "MATH201" }], class_assessments: [] });
    await getPracticeBenchmarkInputs(client, "user-1");
    const notCall = calls.class_assessments!.find((c) => c.method === "not");
    expect(notCall!.args).toEqual(["points_earned", "is", null]);
  });

  it("excludes a graded row with no usable points_possible (can't compute a percentage)", async () => {
    const { client } = makeFakeSupabase({
      classes: [{ id: "c1", short_name: "Calc II", code: "MATH201" }],
      class_assessments: [
        { id: "a1", class_id: "c1", name: "Quiz", date: "2026-09-01", points_earned: 8, points_possible: null },
        { id: "a2", class_id: "c1", name: "Quiz 2", date: "2026-09-08", points_earned: 8, points_possible: 0 },
      ],
    });
    const result = await getPracticeBenchmarkInputs(client, "user-1");
    expect(result).toEqual([]);
  });

  it("computes realPct and joins completed practice tests by assessment_id", async () => {
    const { client } = makeFakeSupabase({
      classes: [{ id: "c1", short_name: "Calc II", code: "MATH201" }],
      class_assessments: [{ id: "a1", class_id: "c1", name: "Midterm", date: "2026-10-01", points_earned: 45, points_possible: 50 }],
      practice_tests: [
        { assessment_id: "a1", interval_label: "T-7", score_pct: 70 },
        { assessment_id: "a1", interval_label: "T-1", score_pct: 88 },
      ],
    });

    const result = await getPracticeBenchmarkInputs(client, "user-1");

    expect(result).toEqual([
      {
        assessmentId: "a1",
        assessmentName: "Midterm",
        className: "Calc II",
        date: "2026-10-01",
        realPct: 90,
        completedPracticeTests: [
          { intervalLabel: "T-7", scorePct: 70 },
          { intervalLabel: "T-1", scorePct: 88 },
        ],
      },
    ]);
  });

  it("a graded assessment with no completed practice tests still appears, with an empty array (the pure function decides whether it counts)", async () => {
    const { client } = makeFakeSupabase({
      classes: [{ id: "c1", short_name: "Calc II", code: "MATH201" }],
      class_assessments: [{ id: "a1", class_id: "c1", name: "Midterm", date: "2026-10-01", points_earned: 45, points_possible: 50 }],
      practice_tests: [],
    });
    const result = await getPracticeBenchmarkInputs(client, "user-1");
    expect(result[0]!.completedPracticeTests).toEqual([]);
  });

  it("scopes the practice_tests read to status='completed' and score_pct IS NOT NULL", async () => {
    const { client, calls } = makeFakeSupabase({
      classes: [{ id: "c1", short_name: "Calc II", code: "MATH201" }],
      class_assessments: [{ id: "a1", class_id: "c1", name: "Midterm", date: "2026-10-01", points_earned: 45, points_possible: 50 }],
      practice_tests: [],
    });
    await getPracticeBenchmarkInputs(client, "user-1");
    const statusCall = calls.practice_tests!.find((c) => c.method === "eq" && c.args[0] === "status");
    const notCall = calls.practice_tests!.find((c) => c.method === "not");
    expect(statusCall!.args).toEqual(["status", "completed"]);
    expect(notCall!.args).toEqual(["score_pct", "is", null]);
  });
});
