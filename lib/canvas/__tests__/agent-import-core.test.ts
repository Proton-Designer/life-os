import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * CANVAS-LITE-02 — `runCanvasImportBatchCore`'s own orchestration (which
 * item kind does what, the course auto-map rule, the counts rollup). The
 * per-assignment decision itself (never-overwrite, unambiguous-match,
 * staging-tombstone) is `processCanvasAssignment`'s own already-tested
 * logic (lib/canvas/__tests__/sync-core.test.ts) — exercised here for
 * real, unmocked, to prove the two callers genuinely share it rather than
 * re-testing rules that file already covers. `stageAnnouncementCore` IS
 * mocked (announcement-extraction-core's own LLM-extraction behavior is
 * covered by its own test file).
 */

const stageAnnouncementCoreMock = vi.fn();
vi.mock("@/lib/school/announcement-extraction-core", () => ({
  stageAnnouncementCore: (...args: unknown[]) => stageAnnouncementCoreMock(...args),
}));

const { runCanvasImportBatchCore } = await import("../agent-import-core");

type Resp = { data: unknown; error: unknown };

/**
 * Same per-table-queue idiom as sync-core.test.ts's own `makeClient`,
 * extended with separate `maybeSingleSeq`/`singleSeq` queues (write-
 * registry-school.test.ts's own convention) since this module hits the
 * SAME table ("staging_batches") through three different terminal
 * methods (a plain array select, a `.maybeSingle()` dedup check, and
 * `.insert(...).select().single()` inside `createStagingBatchCore`) that
 * must never share one queue.
 */
function makeClient(opts: { arraySeq?: Record<string, Resp[]>; maybeSingleSeq?: Record<string, unknown[]>; singleSeq?: Record<string, unknown[]> } = {}) {
  const arraySeq: Record<string, Resp[]> = Object.fromEntries(Object.entries(opts.arraySeq ?? {}).map(([k, v]) => [k, [...v]]));
  const maybeSingleSeq: Record<string, unknown[]> = Object.fromEntries(Object.entries(opts.maybeSingleSeq ?? {}).map(([k, v]) => [k, [...v]]));
  const singleSeq: Record<string, unknown[]> = Object.fromEntries(Object.entries(opts.singleSeq ?? {}).map(([k, v]) => [k, [...v]]));
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
    chain.maybeSingle = vi.fn(async () => ({ data: (maybeSingleSeq[table] ?? []).shift() ?? null, error: null }));
    chain.single = vi.fn(async () => ({ data: (singleSeq[table] ?? []).shift() ?? { id: `${table}-new-id` }, error: null }));
    chain.then = (res: (v: Resp) => void) => res((arraySeq[table] ?? []).shift() ?? { data: [], error: null });
    // upsert never reads `data` back here (real callers only check `error`),
    // and it must resolve independently of arraySeq -- a table hit by BOTH
    // an upsert AND a later plain array select (canvas_course_mappings:
    // processCourseItem's own upsert, then getMappedCourses' select) would
    // otherwise have the upsert's await silently consume the select's own
    // queued response.
    chain.upsert = vi.fn((...args: unknown[]) => {
      calls.push({ table, method: "upsert", args });
      return { then: (res: (v: Resp) => void) => res({ data: null, error: null }) };
    });
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, calls };
}

const tz = "America/Chicago";
const now = new Date("2026-09-16T12:00:00.000Z");

beforeEach(() => {
  stageAnnouncementCoreMock.mockReset();
});

describe("runCanvasImportBatchCore — course items", () => {
  it("a brand-new canvas_course_id is created, unmapped, when no local class matches", async () => {
    const { client, calls } = makeClient({
      maybeSingleSeq: { canvas_course_mappings: [null] },
      arraySeq: { classes: [{ data: [{ id: "class-1", short_name: "Nothing Close", code: null }], error: null }] },
    });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [{ kind: "course", canvasCourseId: "10", canvasCourseName: "Intro to Bio", canvasCourseCode: "BIO101" }]);

    expect(batch.results).toEqual([{ kind: "course", ref: "10", outcome: "created", reason: "new mapping, not yet mapped to a local class" }]);
    expect(batch.counts).toEqual({ created: 1, updated: 0, skipped: 0 });
    const upsert = calls.find((c) => c.table === "canvas_course_mappings" && c.method === "upsert")!;
    expect(upsert.args[0]).toMatchObject({ user_id: "user-1", canvas_course_id: "10", canvas_course_name: "Intro to Bio", canvas_course_code: "BIO101" });
    expect(upsert.args[0]).not.toHaveProperty("class_id");
  });

  it("auto-maps to the single class whose short_name matches the Canvas course name, case-insensitively", async () => {
    const { client, calls } = makeClient({
      maybeSingleSeq: { canvas_course_mappings: [null] },
      arraySeq: { classes: [{ data: [{ id: "class-9", short_name: "intro to bio", code: null }], error: null }] },
    });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [{ kind: "course", canvasCourseId: "10", canvasCourseName: "Intro to Bio", canvasCourseCode: null }]);

    expect(batch.results[0]).toMatchObject({ outcome: "created", reason: "new mapping, auto-mapped to local class class-9" });
    const upsert = calls.find((c) => c.table === "canvas_course_mappings" && c.method === "upsert")!;
    expect((upsert.args[0] as Record<string, unknown>).class_id).toBe("class-9");
  });

  it("does NOT auto-map when two local classes both match -- ambiguous, stays unmapped", async () => {
    const { client, calls } = makeClient({
      maybeSingleSeq: { canvas_course_mappings: [null] },
      arraySeq: {
        classes: [
          {
            data: [
              { id: "class-1", short_name: "Bio", code: null },
              { id: "class-2", short_name: null, code: "BIO" },
            ],
            error: null,
          },
        ],
      },
    });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [{ kind: "course", canvasCourseId: "10", canvasCourseName: "Bio", canvasCourseCode: "BIO" }]);

    expect(batch.results[0]).toMatchObject({ outcome: "created", reason: "new mapping, not yet mapped to a local class" });
    const upsert = calls.find((c) => c.table === "canvas_course_mappings" && c.method === "upsert")!;
    expect(upsert.args[0]).not.toHaveProperty("class_id");
  });

  it("never re-attempts auto-map (or touches class_id at all) once a mapping already has one", async () => {
    const { client, calls } = makeClient({
      maybeSingleSeq: { canvas_course_mappings: [{ class_id: "class-1" }] },
    });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [{ kind: "course", canvasCourseId: "10", canvasCourseName: "Intro to Bio", canvasCourseCode: null }]);

    expect(batch.results[0]).toEqual({ kind: "course", ref: "10", outcome: "updated", reason: "refreshed name/code" });
    const upsert = calls.find((c) => c.table === "canvas_course_mappings" && c.method === "upsert")!;
    expect(upsert.args[0]).not.toHaveProperty("class_id");
  });
});

describe("runCanvasImportBatchCore — assessment items", () => {
  it("an item for an unmapped course is skipped, never guessed at", async () => {
    const { client } = makeClient({ arraySeq: { canvas_course_mappings: [{ data: [], error: null }] } });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [
      { kind: "assessment", canvasCourseId: "unmapped-course", canvasAssignmentId: "assn-1", name: "Essay", dueAt: null, pointsPossible: 100, pointsEarned: 90, gradingType: "points" },
    ]);

    expect(batch.results).toEqual([{ kind: "assessment", ref: "assn-1", outcome: "skipped", reason: "course not mapped to a local class" }]);
    expect(batch.counts).toEqual({ created: 0, updated: 0, skipped: 1 });
  });

  it("grades an unlinked assessment via unambiguous title match (the shared processCanvasAssignment path)", async () => {
    const { client, calls } = makeClient({
      arraySeq: {
        canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }],
        class_assessments: [{ data: [{ id: "a-1", canvas_assignment_id: null, name: "essay 1", date: "2026-09-01", points_earned: null, points_source: null }], error: null }],
        staging_batches: [{ data: [], error: null }],
      },
    });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [
      { kind: "assessment", canvasCourseId: "10", canvasAssignmentId: "assn-1", name: "Essay 1", dueAt: null, pointsPossible: 100, pointsEarned: 88, gradingType: "points" },
    ]);

    expect(batch.results).toEqual([{ kind: "assessment", ref: "assn-1", outcome: "updated", reason: "grade recorded (matched to an existing assessment)" }]);
    expect(batch.counts).toEqual({ created: 0, updated: 1, skipped: 0 });
    const update = calls.find((c) => c.table === "class_assessments" && c.method === "update")!;
    expect(update.args[0]).toEqual({ canvas_assignment_id: "assn-1", points_earned: 88, points_possible: 100, points_source: "canvas" });
  });

  // AC's own required test: "a hand-entered grade survives an import that contains a different value for it."
  it("NEVER overwrites a hand-entered grade -- the exact AC requirement", async () => {
    const { client, calls } = makeClient({
      arraySeq: {
        canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }],
        class_assessments: [{ data: [{ id: "a-1", canvas_assignment_id: "assn-1", name: "Essay", date: "2026-09-01", points_earned: 95, points_source: null }], error: null }],
      },
    });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [
      { kind: "assessment", canvasCourseId: "10", canvasAssignmentId: "assn-1", name: "Essay", dueAt: null, pointsPossible: 100, pointsEarned: 40, gradingType: "points" },
    ]);

    expect(batch.results).toEqual([{ kind: "assessment", ref: "assn-1", outcome: "skipped", reason: "existing grade was entered by hand; Canvas value not applied" }]);
    expect(calls.some((c) => c.table === "class_assessments" && c.method === "update")).toBe(false);
  });

  it("stages an unmatched assignment rather than guessing -- never auto-creates a duplicate assessment", async () => {
    const { client, calls } = makeClient({
      arraySeq: {
        canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }],
        class_assessments: [{ data: [], error: null }],
        staging_batches: [{ data: [], error: null }],
      },
    });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [
      { kind: "assessment", canvasCourseId: "10", canvasAssignmentId: "assn-9", name: "Reading Response", dueAt: null, pointsPossible: 10, pointsEarned: 8, gradingType: "points" },
    ]);

    expect(batch.results).toEqual([{ kind: "assessment", ref: "assn-9", outcome: "created", reason: "no unambiguous local match; staged for review" }]);
    expect(calls.some((c) => c.table === "staging_batches" && c.method === "insert")).toBe(true);
  });

  // AC's own required test: "the same batch sent twice produces the same state, never duplicates."
  it("IDEMPOTENT: re-sending an already-staged assignment id is skipped, never staged twice", async () => {
    const { client } = makeClient({
      arraySeq: {
        canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }],
        class_assessments: [{ data: [], error: null }],
        // Simulates the DB state AFTER a first import already staged this id.
        staging_batches: [{ data: [{ canvas_assignment_id: "assn-9" }], error: null }],
      },
    });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [
      { kind: "assessment", canvasCourseId: "10", canvasAssignmentId: "assn-9", name: "Reading Response", dueAt: null, pointsPossible: 10, pointsEarned: 8, gradingType: "points" },
    ]);

    expect(batch.results).toEqual([{ kind: "assessment", ref: "assn-9", outcome: "skipped", reason: "already staged from a prior import" }]);
    expect(batch.counts).toEqual({ created: 0, updated: 0, skipped: 1 });
  });

  // CANVAS-GAP-03: an agent that doesn't state a grading_type (or states
  // one that isn't points-comparable) must never get an auto-applied
  // grade, the exact same treatment as an unrecognized Canvas type.
  it.each([undefined, null, "pass_fail", "letter_grade"])("grading_type %s on a matched assessment links it but never writes a grade", async (gradingType) => {
    const { client, calls } = makeClient({
      arraySeq: {
        canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }],
        class_assessments: [{ data: [{ id: "a-1", canvas_assignment_id: null, name: "essay 1", date: "2026-09-01", points_earned: null, points_source: null }], error: null }],
        staging_batches: [{ data: [], error: null }],
      },
    });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [
      { kind: "assessment", canvasCourseId: "10", canvasAssignmentId: "assn-1", name: "Essay 1", dueAt: null, pointsPossible: 100, pointsEarned: 88, gradingType: gradingType ?? null },
    ]);

    expect(batch.results).toEqual([
      { kind: "assessment", ref: "assn-1", outcome: "skipped", reason: "grading type isn't points-comparable (pass/fail, letter grade, GPA scale, or not stated) -- no grade applied" },
    ]);
    const update = calls.find((c) => c.table === "class_assessments" && c.method === "update")!;
    expect(update.args[0]).toEqual({ canvas_assignment_id: "assn-1" }); // linked, no points_* fields
  });
});

describe("runCanvasImportBatchCore — announcement items", () => {
  it("an item for an unmapped course is skipped, never guessed at", async () => {
    const { client } = makeClient({ arraySeq: { canvas_course_mappings: [{ data: [], error: null }] } });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [{ kind: "announcement", canvasCourseId: "unmapped-course", canvasAnnouncementId: "ann-1", text: "Midterm moved to Friday." }]);

    expect(batch.results).toEqual([{ kind: "announcement", ref: "ann-1", outcome: "skipped", reason: "course not mapped to a local class" }]);
    expect(stageAnnouncementCoreMock).not.toHaveBeenCalled();
  });

  // AC/idempotency: pre-filtered against the same dedup marker the token poller uses -- never a second LLM call for an already-seen announcement.
  it("IDEMPOTENT: an already-staged announcement id is skipped without a second extraction call", async () => {
    const { client } = makeClient({
      arraySeq: { canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }] },
      maybeSingleSeq: { staging_batches: [{ id: "existing-batch" }] },
    });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [{ kind: "announcement", canvasCourseId: "10", canvasAnnouncementId: "ann-1", text: "Midterm moved to Friday." }]);

    expect(batch.results).toEqual([{ kind: "announcement", ref: "ann-1", outcome: "skipped", reason: "already staged from a prior import" }]);
    expect(stageAnnouncementCoreMock).not.toHaveBeenCalled();
  });

  it("stages a new announcement via the exact existing P2-07 extraction pipeline", async () => {
    const { client } = makeClient({
      arraySeq: { canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }] },
      maybeSingleSeq: { staging_batches: [null] },
    });
    stageAnnouncementCoreMock.mockResolvedValue({ outcome: "extracted", batchId: "b1", itemCount: 2, truncated: false });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [{ kind: "announcement", canvasCourseId: "10", canvasAnnouncementId: "ann-1", text: "Midterm moved to Friday, bring a calculator." }]);

    expect(batch.results).toEqual([{ kind: "announcement", ref: "ann-1", outcome: "created", reason: "staged 2 item(s) for review" }]);
    expect(stageAnnouncementCoreMock).toHaveBeenCalledWith(client, "user-1", "class-1", "Midterm moved to Friday, bring a calculator.", "2026-09-16", "ann-1");
  });

  it("an honest skip, not an error, when the extraction pipeline reports too_short", async () => {
    const { client } = makeClient({
      arraySeq: { canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }] },
      maybeSingleSeq: { staging_batches: [null] },
    });
    stageAnnouncementCoreMock.mockResolvedValue({ outcome: "too_short" });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [{ kind: "announcement", canvasCourseId: "10", canvasAnnouncementId: "ann-1", text: "ok" }]);

    expect(batch.results).toEqual([{ kind: "announcement", ref: "ann-1", outcome: "skipped", reason: "announcement text too short to extract anything from" }]);
  });
});

describe("runCanvasImportBatchCore — mixed batch", () => {
  it("rolls up counts across kinds correctly and never lets one item's outcome bleed into another's", async () => {
    const { client } = makeClient({
      maybeSingleSeq: { canvas_course_mappings: [null] },
      arraySeq: {
        classes: [{ data: [], error: null }],
        // getMappedCourses runs once, AFTER the course item above already
        // upserted -- but this fake's arraySeq is fixed in advance, so it
        // simulates "the new course from this same batch isn't visible to
        // the assessment/announcement resolution step yet" (a real
        // limitation of a single round-trip, not a bug: an agent sending a
        // brand-new course's assignments in the SAME call as the course
        // mapping will see them skipped this run and picked up next run).
        canvas_course_mappings: [{ data: [{ canvas_course_id: "20", class_id: "class-2" }], error: null }],
        class_assessments: [{ data: [{ id: "a-1", canvas_assignment_id: "assn-1", name: "Quiz", date: "2026-09-01", points_earned: null, points_source: null }], error: null }],
      },
    });

    const batch = await runCanvasImportBatchCore(client, "user-1", tz, now, [
      { kind: "course", canvasCourseId: "10", canvasCourseName: "New Course", canvasCourseCode: null },
      { kind: "assessment", canvasCourseId: "20", canvasAssignmentId: "assn-1", name: "Quiz", dueAt: null, pointsPossible: 10, pointsEarned: 9, gradingType: "points" },
    ]);

    expect(batch.counts).toEqual({ created: 1, updated: 1, skipped: 0 });
    expect(batch.results.map((r) => r.kind)).toEqual(["course", "assessment"]);
  });
});
