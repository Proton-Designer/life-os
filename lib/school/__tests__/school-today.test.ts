import { describe, expect, it } from "vitest";
import { getSchoolTodayFeed } from "../school-today";

type Row = Record<string, unknown>;

// Unlike get-class-cards.test.ts's own makeSelectResult (a dumb passthrough that trusts
// each test's fixture is already pre-filtered), this mock actually applies `.eq()`
// predicates — this file's whole point is proving the `date === targetDate` filter is
// real, so the mock has to be able to fail that assertion, not just echo the fixture back.
function makeSelectResult(rows: Row[]) {
  let filtered = rows;
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    eq: (column: string, value: unknown) => {
      filtered = filtered.filter((r) => r[column] === value);
      return chain;
    },
  };
  chain.then = (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: filtered, error: null });
  return chain;
}

function makeFakeSupabase(tables: Record<string, Row[]>) {
  return { from: (table: string) => makeSelectResult(tables[table] ?? []) };
}

function classRow(id: string, code: string, overrides: Row = {}): Row {
  return { id, user_id: "user-1", code, difficulty_rating: null, confidence_rating: null, target_grade_pct: null, ...overrides };
}

function assessmentRow(id: string, classId: string, name: string, date: string, overrides: Row = {}): Row {
  return { id, user_id: "user-1", class_id: classId, name, date, weight_pct: null, ...overrides };
}

const TODAY = "2026-09-15"; // a Tuesday

describe("getSchoolTodayFeed", () => {
  it("returns an empty list when nothing is due on targetDate, real state not fabricated", async () => {
    const supabase = makeFakeSupabase({
      classes: [classRow("c1", "MATH 2418")],
      class_assessments: [assessmentRow("a1", "c1", "Quiz", "2026-09-20")],
    });
    const result = await getSchoolTodayFeed(supabase as never, "user-1", TODAY, TODAY);
    expect(result).toEqual([]);
  });

  it("includes only assessments due exactly on targetDate, across every class", async () => {
    const supabase = makeFakeSupabase({
      classes: [classRow("c1", "MATH 2418"), classRow("c2", "CS 3345")],
      class_assessments: [
        assessmentRow("a1", "c1", "Quiz 2", TODAY),
        assessmentRow("a2", "c1", "Not today", "2026-09-16"),
        assessmentRow("a3", "c2", "Homework 3", TODAY),
      ],
    });
    const result = await getSchoolTodayFeed(supabase as never, "user-1", TODAY, TODAY);
    expect(result.map((r) => r.id).sort()).toEqual(["a1", "a3"]);
  });

  it("formats the title as 'CODE · name · due Thu', matching the spec verbatim", async () => {
    const supabase = makeFakeSupabase({
      classes: [classRow("c1", "MATH 2418")],
      class_assessments: [assessmentRow("a1", "c1", "Quiz 2", TODAY)],
    });
    const result = await getSchoolTodayFeed(supabase as never, "user-1", TODAY, TODAY);
    expect(result[0]!.title).toBe("MATH 2418 · Quiz 2 · due Tue");
  });

  it("ranks by risk score descending, highest first", async () => {
    const supabase = makeFakeSupabase({
      classes: [classRow("a", "A"), classRow("b", "B")],
      class_assessments: [
        // Same due date and no weight/difficulty/confidence set, so the only lever left to
        // produce a real, engine-computed score difference is weight_pct itself (R35: a set
        // weight is a real risk factor the engine actually scores on).
        assessmentRow("low", "a", "Low risk", TODAY, { weight_pct: 2 }),
        assessmentRow("critical", "b", "Critical risk", TODAY, { weight_pct: 95 }),
      ],
    });
    const result = await getSchoolTodayFeed(supabase as never, "user-1", TODAY, TODAY);
    expect(result.map((r) => r.id)).toEqual(["critical", "low"]);
  });

  // The whole reason `todayStr` and `targetDate` are separate parameters (Opus Lead
  // ruling): #28 (Night Plan) will call this with targetDate = tomorrow while todayStr
  // stays the real today, and the risk score must reflect genuine urgency relative to
  // NOW, not treat tomorrow as though it were already today.
  it("computes risk proximity from todayStr, not targetDate — an item due tomorrow scores as 1 day out, not 0", async () => {
    const tomorrow = "2026-09-16";
    const supabase = makeFakeSupabase({
      classes: [classRow("c1", "MATH 2418")],
      class_assessments: [assessmentRow("a1", "c1", "Quiz", tomorrow, { weight_pct: 50 })],
    });
    const dueTodayResult = await getSchoolTodayFeed(
      makeFakeSupabase({
        classes: [classRow("c1", "MATH 2418")],
        class_assessments: [assessmentRow("a2", "c1", "Quiz", TODAY, { weight_pct: 50 })],
      }) as never,
      "user-1",
      TODAY,
      TODAY
    );
    const dueTomorrowResult = await getSchoolTodayFeed(supabase as never, "user-1", TODAY, tomorrow);
    // An item due today (proximity maxed) must score strictly higher than the identical
    // item due tomorrow (proximity one day out) when both are scored from the SAME real
    // today — if targetDate leaked into the proximity calculation, these would tie.
    expect(dueTodayResult[0]!.risk.score).toBeGreaterThan(dueTomorrowResult[0]!.risk.score);
  });
});
