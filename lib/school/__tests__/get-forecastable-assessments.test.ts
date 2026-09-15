import { describe, it, expect, vi } from "vitest";
import { getForecastableAssessments } from "../get-forecastable-assessments";

type Row = Record<string, unknown>;

/** Same thenable-chain fake shape as lib/school/__tests__/get-class-cards.test.ts's own. */
function makeSelectResult(rows: Row[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows, error: null });
  return chain;
}

function makeFakeSupabase(tables: Record<string, Row[]>) {
  return { from: vi.fn((table: string) => makeSelectResult(tables[table] ?? [])) } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("getForecastableAssessments (P3-10)", () => {
  it("returns [] without querying assessments when the user has no classes", async () => {
    const supabase = makeFakeSupabase({ classes: [] });
    const result = await getForecastableAssessments(supabase, "user-1");
    expect(result).toEqual([]);
    expect((supabase.from as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("classes");
    expect((supabase.from as ReturnType<typeof vi.fn>)).not.toHaveBeenCalledWith("class_assessments");
  });

  it("joins each assessment to its class's display name (short_name preferred over code)", async () => {
    const supabase = makeFakeSupabase({
      classes: [
        { id: "c1", short_name: "Calc II", code: "MATH201" },
        { id: "c2", short_name: null, code: "CHEM101" },
      ],
      class_assessments: [
        { id: "a1", class_id: "c1", name: "Midterm", date: "2026-10-01", weight_pct: 30, points_earned: null, is_excused: false },
        { id: "a2", class_id: "c2", name: "Lab report", date: "2026-10-05", weight_pct: null, points_earned: null, is_excused: false },
      ],
    });

    const result = await getForecastableAssessments(supabase, "user-1");

    expect(result).toEqual([
      { id: "a1", name: "Midterm", className: "Calc II", date: "2026-10-01", weightPct: 30, pointsEarned: null, isExcused: false },
      { id: "a2", name: "Lab report", className: "CHEM101", date: "2026-10-05", weightPct: null, pointsEarned: null, isExcused: false },
    ]);
  });

  it("passes every assessment through unfiltered (computeCourseLoadForecast does its own upcoming/excused/graded filtering)", async () => {
    const supabase = makeFakeSupabase({
      classes: [{ id: "c1", short_name: "Calc II", code: "MATH201" }],
      class_assessments: [
        { id: "a1", class_id: "c1", name: "Past exam", date: "2020-01-01", weight_pct: 10, points_earned: 90, is_excused: false },
        { id: "a2", class_id: "c1", name: "Excused quiz", date: "2026-10-01", weight_pct: 5, points_earned: null, is_excused: true },
      ],
    });

    const result = await getForecastableAssessments(supabase, "user-1");

    expect(result).toHaveLength(2);
  });
});
