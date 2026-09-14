import { describe, expect, it } from "vitest";
import { computePlanSeeds } from "../actions";

type Row = Record<string, unknown>;

// Real .eq()/.is() filtering (not a passthrough) — this suite's whole point is proving
// computePlanSeeds passes the RIGHT date to getSchoolTodayFeed for each caller, which a
// mock that ignores its filters could never actually verify.
function makeSelectResult(rows: Row[]) {
  let filtered = rows;
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    not: () => chain,
    eq: (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val);
      return chain;
    },
    is: (col: string, _val: null) => {
      filtered = filtered.filter((r) => r[col] == null);
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

describe("computePlanSeeds — Phase 1 #28: school_risk wiring", () => {
  it("seeds nothing due on the planning date as an empty array, not an error — the ordinary case for most users", async () => {
    const supabase = makeFakeSupabase({ tasks: [], goal_milestones: [], classes: [], class_assessments: [] });
    const seeds = await computePlanSeeds(supabase as never, "user-1", "America/Chicago", new Date("2026-09-15T12:00:00Z"), "2026-09-16", new Set());
    expect(seeds.filter((s) => s.source === "school_risk")).toEqual([]);
  });

  it("includes an assessment due on the PLANNING DATE as a school_risk seed, with the CODE · name · due <day> title", async () => {
    const supabase = makeFakeSupabase({
      tasks: [],
      goal_milestones: [],
      classes: [classRow("c1", "MATH 2418")],
      class_assessments: [assessmentRow("a1", "c1", "Midterm", "2026-09-16")],
    });
    // today (real now) is 09-15; planning FOR tomorrow, 09-16 — the evening-close shape.
    const seeds = await computePlanSeeds(supabase as never, "user-1", "America/Chicago", new Date("2026-09-15T12:00:00Z"), "2026-09-16", new Set());
    const schoolSeeds = seeds.filter((s) => s.source === "school_risk");
    expect(schoolSeeds).toHaveLength(1);
    expect(schoolSeeds[0]!.id).toBe("a1");
    expect(schoolSeeds[0]!.title).toBe("MATH 2418 · Midterm · due Wed");
  });

  // The whole reason planningDate and todayStr are separate: an evening close (real today
  // 09-15) plans for TOMORROW (09-16) — an assessment due today must NOT be seeded into
  // tomorrow's plan, and one due tomorrow must NOT be scored as though it were due today.
  it("does not seed an assessment due TODAY when planning for tomorrow — planningDate governs which day is seeded", async () => {
    const supabase = makeFakeSupabase({
      tasks: [],
      goal_milestones: [],
      classes: [classRow("c1", "MATH 2418")],
      class_assessments: [assessmentRow("a1", "c1", "Due today, not tomorrow", "2026-09-15")],
    });
    const seeds = await computePlanSeeds(supabase as never, "user-1", "America/Chicago", new Date("2026-09-15T12:00:00Z"), "2026-09-16", new Set());
    expect(seeds.filter((s) => s.source === "school_risk")).toEqual([]);
  });

  it("respects excludeIds for school_risk seeds too, not just worries/milestones", async () => {
    const supabase = makeFakeSupabase({
      tasks: [],
      goal_milestones: [],
      classes: [classRow("c1", "MATH 2418")],
      class_assessments: [assessmentRow("a1", "c1", "Midterm", "2026-09-16")],
    });
    const seeds = await computePlanSeeds(
      supabase as never,
      "user-1",
      "America/Chicago",
      new Date("2026-09-15T12:00:00Z"),
      "2026-09-16",
      new Set(["a1"]) // already dumped/claimed
    );
    expect(seeds.filter((s) => s.source === "school_risk")).toEqual([]);
  });

  it("a same-day replan (planningDate === today) seeds what's due today, not tomorrow", async () => {
    const supabase = makeFakeSupabase({
      tasks: [],
      goal_milestones: [],
      classes: [classRow("c1", "MATH 2418")],
      class_assessments: [
        assessmentRow("today-item", "c1", "Due today", "2026-09-15"),
        assessmentRow("tomorrow-item", "c1", "Due tomorrow", "2026-09-16"),
      ],
    });
    const seeds = await computePlanSeeds(supabase as never, "user-1", "America/Chicago", new Date("2026-09-15T12:00:00Z"), "2026-09-15", new Set());
    const schoolSeeds = seeds.filter((s) => s.source === "school_risk");
    expect(schoolSeeds.map((s) => s.id)).toEqual(["today-item"]);
  });
});
