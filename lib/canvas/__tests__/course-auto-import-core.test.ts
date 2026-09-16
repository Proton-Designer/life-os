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

  it("leaves an already-linked course untouched", async () => {
    const { client, calls } = makeClient({
      arraySeq: { canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1", dismissed_at: null }], error: null }] },
    });

    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [{ canvasCourseId: "10", name: "Bio", courseCode: "BIO101" }]);

    expect(result).toEqual({ created: 0, adopted: 0, alreadyLinked: 1, skippedDismissed: 0 });
    expect(calls.some((c) => c.table === "classes")).toBe(false);
    expect(calls.some((c) => c.table === "canvas_course_mappings" && c.method === "upsert")).toBe(false);
  });

  it("skips a dismissed mapping -- removal sticks, never auto-recreated", async () => {
    const { client, calls } = makeClient({
      arraySeq: { canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: null, dismissed_at: "2026-09-16T00:00:00.000Z" }], error: null }] },
    });

    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [{ canvasCourseId: "10", name: "Bio", courseCode: "BIO101" }]);

    expect(result).toEqual({ created: 0, adopted: 0, alreadyLinked: 0, skippedDismissed: 1 });
    expect(calls.some((c) => c.table === "classes")).toBe(false);
    expect(createClassCoreMock).not.toHaveBeenCalled();
  });

  it("adopts an unambiguous hand-made class instead of creating a duplicate", async () => {
    const { client, calls } = makeClient({
      arraySeq: {
        canvas_course_mappings: [{ data: [], error: null }],
        classes: [{ data: [{ id: "class-9", short_name: "Bio", code: null }], error: null }],
      },
    });

    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [{ canvasCourseId: "10", name: "Bio", courseCode: "BIO101" }]);

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

    const result = await autoImportCanvasCoursesAsClassesCore(client, userId, [{ canvasCourseId: "10", name: "Organic Chemistry II", courseCode: "CHEM-2412" }]);

    expect(result).toEqual({ created: 1, adopted: 0, alreadyLinked: 0, skippedDismissed: 0 });
    expect(createClassCoreMock).toHaveBeenCalledWith(client, userId, { shortName: "Organic Chemistry II", code: "CHEM-2412" });
    const upsert = calls.find((c) => c.table === "canvas_course_mappings" && c.method === "upsert")!;
    expect(upsert.args[0]).toMatchObject({ class_id: "class-new-id" });
  });

  it("derives a code when Canvas sends no course_code for a newly-created class", async () => {
    const { client } = makeClient({
      arraySeq: { canvas_course_mappings: [{ data: [], error: null }], classes: [{ data: [], error: null }] },
    });

    await autoImportCanvasCoursesAsClassesCore(client, userId, [{ canvasCourseId: "10", name: "Organic Chemistry II", courseCode: null }]);

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
      { canvasCourseId: "1", name: "Already Linked", courseCode: null },
      { canvasCourseId: "2", name: "Dismissed Course", courseCode: null },
      { canvasCourseId: "3", name: "Bio", courseCode: null }, // matches class-9
      { canvasCourseId: "4", name: "Brand New Course", courseCode: "NEW101" }, // no match -- created
    ]);

    expect(result).toEqual({ created: 1, adopted: 1, alreadyLinked: 1, skippedDismissed: 1 });
  });
});
