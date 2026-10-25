import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * CANVAS-LITE-03 — `autoImportCanvasCoursesAsClassesCore`'s own
 * orchestration (already-linked / dismissed / adopt / create branching,
 * and the counts rollup the Settings summary line depends on).
 * `createClassCore` is mocked -- its own creation logic is already tested
 * in lib/school/__tests__/actions-core.test.ts; this file is about WHEN
 * it gets called, not how it inserts a row. `findUnambiguousClassMatch`
 * is NOT mocked -- it's the exact function CANVAS-LITE-02's agent-import
 * path also uses (lib/canvas/__tests__/agent-import-core.test.ts), and
 * exercising it here for real proves the two callers genuinely share it.
 */

const createClassCoreMock = vi.fn(async (..._args: unknown[]) => "class-new-id");
vi.mock("@/lib/school/actions-core", () => ({
  createClassCore: (...args: unknown[]) => createClassCoreMock(...args),
}));

const { autoImportCanvasCoursesAsClassesCore, deriveClassCode } = await import("../course-auto-import-core");

type Resp = { data: unknown; error: unknown };

function makeClient(opts: { arraySeq?: Record<string, Resp[]> } = {}) {
  const arraySeq: Record<string, Resp[]> = Object.fromEntries(Object.entries(opts.arraySeq ?? {}).map(([k, v]) => [k, [...v]]));
  const calls: { table: string; method: string; args: unknown[] }[] = [];

  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    for (const method of ["select", "eq", "in", "not", "update", "insert"]) chain[method] = vi.fn(record(method));
    chain.then = (res: (v: Resp) => void) => res((arraySeq[table] ?? []).shift() ?? { data: [], error: null });
    chain.upsert = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: "upsert", args });
      return { then: (res: (v: Resp) => void) => res({ data: null, error: null }) };
    });
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, calls };
}

const userId = "user-1";

beforeEach(() => {
  createClassCoreMock.mockClear();
  createClassCoreMock.mockResolvedValue("class-new-id");
});

describe("deriveClassCode", () => {
  it("takes initials of a multi-word course name, uppercased", () => {
    expect(deriveClassCode("Organic Chemistry II")).toBe("OCI");
  });

  it("falls back to the word itself, uppercased and capped, for a single-word name", () => {
    expect(deriveClassCode("Calculus")).toBe("CALCULUS");
  });

  it("never returns an empty string", () => {
    expect(deriveClassCode("!!!")).toBe("CLASS");
  });
});

describe("autoImportCanvasCoursesAsClassesCore", () => {
  it("returns all-zero counts and touches nothing for an empty course list", async () => {
    const { client, calls } = makeClient({});
    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, []);
    expect(result).toEqual({ created: 0, adopted: 0, alreadyLinked: 0, skippedDismissed: 0 });
    expect(calls).toHaveLength(0);
  });

  // CANVAS-GAP-01 changed this: class_id stays untouched for an
  // already-linked course, but the row itself is no longer skipped
  // entirely -- the computed-grade snapshot must stay fresh every sync.
  it("leaves class_id untouched for an already-linked course, but still refreshes its computed-grade snapshot", async () => {
    const { client, calls } = makeClient({
      arraySeq: { canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1", dismissed_at: null }], error: null }] },
    });

    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [
      { canvasCourseId: "10", name: "Bio", courseCode: "BIO101", computedCurrentScore: 91.4, computedFinalScore: 88.2, computedCurrentLetterGrade: "A-" },
    ]);

    expect(result).toEqual({ created: 0, adopted: 0, alreadyLinked: 1, skippedDismissed: 0 });
    expect(calls.some((c) => c.table === "classes")).toBe(false); // no resolution needed -- never even looks up local classes
    expect(createClassCoreMock).not.toHaveBeenCalled();
    const upsert = calls.find((c) => c.table === "canvas_course_mappings" && c.method === "upsert")!;
    expect(upsert.args[0]).toMatchObject({ computed_current_score: 91.4, computed_final_score: 88.2, computed_current_letter_grade: "A-" });
    expect(upsert.args[0]).not.toHaveProperty("class_id");
  });

  it("skips class resolution for a dismissed mapping -- removal sticks, never auto-recreated -- but still refreshes its cached name/code/computed-grade", async () => {
    const { client, calls } = makeClient({
      arraySeq: { canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: null, dismissed_at: "2026-09-16T00:00:00.000Z" }], error: null }] },
    });

    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [
      { canvasCourseId: "10", name: "Bio", courseCode: "BIO101", computedCurrentScore: 70, computedFinalScore: null, computedCurrentLetterGrade: null },
    ]);

    expect(result).toEqual({ created: 0, adopted: 0, alreadyLinked: 0, skippedDismissed: 1 });
    expect(calls.some((c) => c.table === "classes")).toBe(false);
    expect(createClassCoreMock).not.toHaveBeenCalled();
    const upsert = calls.find((c) => c.table === "canvas_course_mappings" && c.method === "upsert")!;
    expect(upsert.args[0]).toMatchObject({ canvas_course_name: "Bio", computed_current_score: 70 });
    expect(upsert.args[0]).not.toHaveProperty("class_id");
  });

  // Opus Lead ruling: the snapshot must never feed Deadline risk, Course
  // load, or Practice-vs-real (which all read points_earned) -- asserted
  // directly by proving this whole module never touches class_assessments.
  it("NEVER touches class_assessments -- the computed-grade snapshot is course-level only, display-only", async () => {
    const { client, calls } = makeClient({
      arraySeq: {
        canvas_course_mappings: [{ data: [], error: null }],
        classes: [{ data: [], error: null }],
      },
    });

    await autoImportCanvasCoursesAsClassesCore(client, userId, [
      { canvasCourseId: "10", name: "Bio", courseCode: "BIO101", computedCurrentScore: 91.4, computedFinalScore: 88.2, computedCurrentLetterGrade: "A-" },
    ]);

    expect(calls.some((c) => c.table === "class_assessments")).toBe(false);
  });

  it("adopts an unambiguous hand-made class instead of creating a duplicate", async () => {
    const { client, calls } = makeClient({
      arraySeq: {
        canvas_course_mappings: [{ data: [], error: null }],
        classes: [{ data: [{ id: "class-9", short_name: "Bio", code: null }], error: null }],
      },
    });

    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [{ canvasCourseId: "10", name: "Bio", courseCode: "BIO101", computedCurrentScore: null, computedFinalScore: null, computedCurrentLetterGrade: null }]);

    expect(result).toEqual({ created: 0, adopted: 1, alreadyLinked: 0, skippedDismissed: 0 });
    expect(createClassCoreMock).not.toHaveBeenCalled();
    const upsert = calls.find((c) => c.table === "canvas_course_mappings" && c.method === "upsert")!;
    expect(upsert.args[0]).toMatchObject({ user_id: userId, canvas_course_id: "10", class_id: "class-9" });
  });

  it("creates a new class when no unambiguous local match exists", async () => {
    const { client, calls } = makeClient({
      arraySeq: {
        canvas_course_mappings: [{ data: [], error: null }],
        classes: [{ data: [], error: null }],
      },
    });

    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [{ canvasCourseId: "10", name: "Organic Chemistry II", courseCode: "CHEM-2412", computedCurrentScore: null, computedFinalScore: null, computedCurrentLetterGrade: null }]);

    expect(result).toEqual({ created: 1, adopted: 0, alreadyLinked: 0, skippedDismissed: 0 });
    expect(createClassCoreMock).toHaveBeenCalledWith(client, userId, { shortName: "Organic Chemistry II", code: "CHEM-2412" });
    const upsert = calls.find((c) => c.table === "canvas_course_mappings" && c.method === "upsert")!;
    expect(upsert.args[0]).toMatchObject({ class_id: "class-new-id" });
  });

  it("derives a code when Canvas sends no course_code for a newly-created class", async () => {
    const { client } = makeClient({
      arraySeq: { canvas_course_mappings: [{ data: [], error: null }], classes: [{ data: [], error: null }] },
    });

    await autoImportCanvasCoursesAsClassesCore(client, userId, [{ canvasCourseId: "10", name: "Organic Chemistry II", courseCode: null, computedCurrentScore: null, computedFinalScore: null, computedCurrentLetterGrade: null }]);

    expect(createClassCoreMock).toHaveBeenCalledWith(client, userId, { shortName: "Organic Chemistry II", code: "OCI" });
  });

  it("resolves a mixed batch independently per course -- one dismissed, one already linked, one adopted, one created", async () => {
    const { client } = makeClient({
      arraySeq: {
        canvas_course_mappings: [
          {
            data: [
              { canvas_course_id: "1", class_id: "class-1", dismissed_at: null },
              { canvas_course_id: "2", class_id: null, dismissed_at: "2026-09-16T00:00:00.000Z" },
            ],
            error: null,
          },
        ],
        classes: [{ data: [{ id: "class-9", short_name: "Bio", code: null }], error: null }],
      },
    });

    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [
      { canvasCourseId: "1", name: "Already Linked", courseCode: null, computedCurrentScore: null, computedFinalScore: null, computedCurrentLetterGrade: null },
      { canvasCourseId: "2", name: "Dismissed Course", courseCode: null, computedCurrentScore: null, computedFinalScore: null, computedCurrentLetterGrade: null },
      { canvasCourseId: "3", name: "Bio", courseCode: null, computedCurrentScore: null, computedFinalScore: null, computedCurrentLetterGrade: null }, // matches class-9
      { canvasCourseId: "4", name: "Brand New Course", courseCode: "NEW101", computedCurrentScore: null, computedFinalScore: null, computedCurrentLetterGrade: null }, // no match -- created
    ]);

    expect(result).toEqual({ created: 1, adopted: 1, alreadyLinked: 1, skippedDismissed: 1 });
  });
});

describe("autoImportCanvasCoursesAsClassesCore — match by course number before creating (ICS feed labels)", () => {
  const ICS_LABEL = "CS 3345.HON - F26";
  const icsCourse = (id: string, label: string) => ({ canvasCourseId: id, name: label, courseCode: label, computedCurrentScore: null, computedFinalScore: null, computedCurrentLetterGrade: null });

  it("a feed label 'CS 3345.HON - F26' is MAPPED to the existing class 'CS-3345-HON', and no duplicate class is created", async () => {
    const { client, calls } = makeClient({
      arraySeq: {
        canvas_course_mappings: [{ data: [], error: null }],
        classes: [{ data: [{ id: "dsa", short_name: "DSA", code: "CS-3345-HON" }], error: null }],
      },
    });
    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [icsCourse("20333", ICS_LABEL)]);
    expect(createClassCoreMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ created: 0, adopted: 1 });
    const upsert = calls.find((c) => c.table === "canvas_course_mappings" && c.method === "upsert")!;
    expect((upsert.args[0] as { class_id: string }).class_id).toBe("dsa");
  });

  it("all three of his courses map to his three classes, the cross-listed label included", async () => {
    const { client, calls } = makeClient({
      arraySeq: {
        canvas_course_mappings: [{ data: [], error: null }],
        classes: [
          {
            data: [
              { id: "dsa", short_name: "DSA", code: "CS-3345-HON" },
              { id: "comm", short_name: "Prof Comm", code: "ECS-2390-5H3" },
              { id: "stats", short_name: "Prob & Stats", code: "CS-3341-HON" },
            ],
            error: null,
          },
        ],
      },
    });
    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [
      icsCourse("20333", "CS 3345.HON - F26"),
      icsCourse("20068", "ECS 2390.5H3 - F26"),
      icsCourse("20152", "CS-3341.HON-SE-3341.HON-STAT-3341.HON - F26"),
    ]);
    expect(createClassCoreMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ created: 0, adopted: 3 });
    const mapped = calls.filter((c) => c.method === "upsert").map((c) => (c.args[0] as { canvas_course_id: string; class_id: string }));
    expect(mapped).toEqual([
      expect.objectContaining({ canvas_course_id: "20333", class_id: "dsa" }),
      expect.objectContaining({ canvas_course_id: "20068", class_id: "comm" }),
      expect.objectContaining({ canvas_course_id: "20152", class_id: "stats" }),
    ]);
  });

  it("zero matches still creates, as before (a course the person has no class for)", async () => {
    const { client } = makeClient({ arraySeq: { canvas_course_mappings: [{ data: [], error: null }], classes: [{ data: [{ id: "other", short_name: "Bio", code: "BIO-1010" }], error: null }] } });
    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [icsCourse("1", ICS_LABEL)]);
    expect(createClassCoreMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ created: 1, adopted: 0 });
  });

  it("an ambiguous number (two classes share it) creates rather than guessing", async () => {
    const { client } = makeClient({
      arraySeq: {
        canvas_course_mappings: [{ data: [], error: null }],
        classes: [{ data: [{ id: "a", short_name: "DSA", code: "CS-3345-HON" }, { id: "b", short_name: "DSA Lab", code: "CS 3345 L" }], error: null }],
      },
    });
    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [icsCourse("1", ICS_LABEL)]);
    expect(result).toMatchObject({ created: 1, adopted: 0 });
  });

  it("the token path benefits too: a Canvas course whose code is 'CS 3345.HON' adopts the existing class", async () => {
    const { client } = makeClient({ arraySeq: { canvas_course_mappings: [{ data: [], error: null }], classes: [{ data: [{ id: "dsa", short_name: "DSA", code: "CS-3345-HON" }], error: null }] } });
    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [
      { canvasCourseId: "9", name: "Data Structures and Algorithms (Honors)", courseCode: "CS 3345.HON", computedCurrentScore: null, computedFinalScore: null, computedCurrentLetterGrade: null },
    ]);
    expect(result).toMatchObject({ created: 0, adopted: 1 });
  });
});
