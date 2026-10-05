import { describe, expect, it } from "vitest";
import { ASSESSMENT_TYPES, ASSESSMENT_VIEW_PATHS, PICKABLE_ASSESSMENT_TYPES, isAssessmentType, normalizeAssessmentType } from "../assessment-types";
import { EXAM_NAME_PLACEHOLDER, TASK_TYPE_OPTIONS, normalizeTaskType } from "@/lib/tasks/task-type";

describe("final_midterm -> exam (SCHOOL-01)", () => {
  it("normalises only the legacy value", () => {
    expect(normalizeAssessmentType("final_midterm")).toBe("exam");
    for (const t of ["quiz", "exam", "homework_assignment", "project_paper"] as const) expect(normalizeAssessmentType(t)).toBe(t);
    expect(normalizeTaskType("final_midterm")).toBe("exam");
    expect(normalizeTaskType("reading_review")).toBe("reading_review");
  });
  it("the DB-facing list still accepts final_midterm (old clients must not fail), but pickers never offer it", () => {
    expect(ASSESSMENT_TYPES).toContain("final_midterm");
    expect(isAssessmentType("final_midterm")).toBe(true);
    expect(PICKABLE_ASSESSMENT_TYPES).not.toContain("final_midterm");
    expect(PICKABLE_ASSESSMENT_TYPES).toContain("exam");
    expect(TASK_TYPE_OPTIONS.map((o) => o.value)).not.toContain("final_midterm");
    expect(TASK_TYPE_OPTIONS.map((o) => o.value)).toContain("exam");
    expect(TASK_TYPE_OPTIONS.find((o) => o.value === "exam")!.label).toBe("Exam");
  });
  it("rejects values that are not assessment types", () => {
    expect(isAssessmentType("reminder")).toBe(false);
    expect(isAssessmentType(undefined)).toBe(false);
  });
  it("the exam name placeholder says Midterm or Final", () => {
    expect(EXAM_NAME_PLACEHOLDER).toBe("e.g. Midterm 1, Final exam");
  });
  it("every page that shows an assessment (through its paired task) is in the one revalidate list", () => {
    expect([...ASSESSMENT_VIEW_PATHS]).toEqual(["/school", "/", "/calendar", "/close"]);
  });
});
