import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * P2-21 — the two Canvas poll jobs. Every Canvas-client/core dependency is
 * mocked at the module level; these tests are about sync-core's own
 * orchestration (which course gets which call, the dedup pre-filters, the
 * never-overwrite-a-grade guard, the unambiguous-match rules, and the
 * connection sync-status writes) — not re-proving lib/canvas/client.ts's
 * or lib/school/staging-core.ts's own already-tested behavior.
 */

const resolveCanvasConnectionCoreMock = vi.fn();
const recordCanvasSyncOutcomeCoreMock = vi.fn();
vi.mock("@/lib/canvas/connection-core", () => ({
  resolveCanvasConnectionCore: (...args: unknown[]) => resolveCanvasConnectionCoreMock(...args),
  recordCanvasSyncOutcomeCore: (...args: unknown[]) => recordCanvasSyncOutcomeCoreMock(...args),
}));

const fetchCanvasAnnouncementsMock = vi.fn();
const fetchCanvasGradedAssignmentsMock = vi.fn();
vi.mock("@/lib/canvas/client", () => ({
  fetchCanvasAnnouncements: (...args: unknown[]) => fetchCanvasAnnouncementsMock(...args),
  fetchCanvasGradedAssignments: (...args: unknown[]) => fetchCanvasGradedAssignmentsMock(...args),
}));

const stageAnnouncementCoreMock = vi.fn();
vi.mock("@/lib/school/announcement-extraction-core", () => ({
  stageAnnouncementCore: (...args: unknown[]) => stageAnnouncementCoreMock(...args),
}));

const createStagingBatchCoreMock = vi.fn(async (..._args: unknown[]) => "batch-new");
const createStagedDeliverablesCoreMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/school/staging-core", () => ({
  createStagingBatchCore: (...args: unknown[]) => createStagingBatchCoreMock(...args),
  createStagedDeliverablesCore: (...args: unknown[]) => createStagedDeliverablesCoreMock(...args),
}));

const { syncCanvasAnnouncementsCore, syncCanvasGradesCore, processCanvasAssignment } = await import("../sync-core");
type CanvasAssignmentSyncState = Parameters<typeof processCanvasAssignment>[5];

/**
 * A per-table queue fake, same idiom as lib/habits/__tests__/actions-core.test.ts's
 * own makeClient — each `.from(table)` call pops the next queued response
 * for that table (or falls back to an empty-array default so an
 * unconfigured table read never throws).
 */
type Resp = { data: unknown; error: unknown };
function makeClient(responses: Record<string, Resp[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const queues: Record<string, Resp[]> = Object.fromEntries(Object.entries(responses).map(([k, v]) => [k, [...v]]));

  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    for (const method of ["select", "eq", "in", "not", "update", "maybeSingle"]) chain[method] = vi.fn(record(method));
    const resolve = (): Resp => (queues[table] ?? []).shift() ?? { data: [], error: null };
    chain.then = (res: (v: Resp) => void) => res(resolve());
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, calls };
}

const now = new Date("2026-09-15T12:00:00.000Z");
const tz = "America/Chicago";

beforeEach(() => {
  resolveCanvasConnectionCoreMock.mockReset();
  recordCanvasSyncOutcomeCoreMock.mockReset();
  fetchCanvasAnnouncementsMock.mockReset();
  fetchCanvasGradedAssignmentsMock.mockReset();
  stageAnnouncementCoreMock.mockReset();
  createStagingBatchCoreMock.mockClear();
  createStagedDeliverablesCoreMock.mockClear();
  resolveCanvasConnectionCoreMock.mockResolvedValue({ instanceUrl: "https://school.instructure.com", token: "tok" });
});

describe("syncCanvasAnnouncementsCore", () => {
  it("returns {ok:false} and never resolves the connection when token_status isn't 'ok'", async () => {
    const { client } = makeClient({ canvas_connections: [{ data: { token_status: "expired" }, error: null }] });
    const result = await syncCanvasAnnouncementsCore(client, "user-1", tz, now);
    expect(result).toEqual({ ok: false });
    expect(resolveCanvasConnectionCoreMock).not.toHaveBeenCalled();
  });

  it("stages every announcement not already dedup-marked, skips the rest, records ok", async () => {
    const { client } = makeClient({
      canvas_connections: [{ data: { token_status: "ok" }, error: null }],
      canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }],
      staging_batches: [{ data: [{ canvas_announcement_id: "a1" }], error: null }], // a1 already staged
    });
    fetchCanvasAnnouncementsMock.mockResolvedValue({
      ok: true,
      data: [
        { canvasAnnouncementId: "a1", title: "Old", messageHtml: "<p>old</p>", postedAt: "2026-09-01T00:00:00Z" },
        { canvasAnnouncementId: "a2", title: "New", messageHtml: "<p>new one</p>", postedAt: "2026-09-14T00:00:00Z" },
      ],
    });
    stageAnnouncementCoreMock.mockResolvedValue({ outcome: "extracted", batchId: "b1", itemCount: 1, truncated: false });

    const result = await syncCanvasAnnouncementsCore(client, "user-1", tz, now);

    expect(result).toEqual({ ok: true, staged: 1 });
    expect(stageAnnouncementCoreMock).toHaveBeenCalledTimes(1);
    expect(stageAnnouncementCoreMock).toHaveBeenCalledWith(client, "user-1", "class-1", "new one", "2026-09-15", "a2");
    expect(recordCanvasSyncOutcomeCoreMock).toHaveBeenCalledWith(client, "user-1", { kind: "ok" });
  });

  it("a fetch failure for one course records sync_failed and does not throw", async () => {
    const { client } = makeClient({
      canvas_connections: [{ data: { token_status: "ok" }, error: null }],
      canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }],
    });
    fetchCanvasAnnouncementsMock.mockResolvedValue({ ok: false, message: "Canvas returned an error (HTTP 503)." });

    const result = await syncCanvasAnnouncementsCore(client, "user-1", tz, now);

    expect(result).toEqual({ ok: true, staged: 0 });
    expect(recordCanvasSyncOutcomeCoreMock).toHaveBeenCalledWith(client, "user-1", { kind: "sync_failed", message: "Canvas returned an error (HTTP 503).", authExpired: undefined });
    // A failure this run means "ok" is never separately re-recorded on top of it.
    expect(recordCanvasSyncOutcomeCoreMock).toHaveBeenCalledTimes(1);
  });
});

describe("syncCanvasGradesCore", () => {
  it("case (a): already-linked assessment with no grade yet gets updated, points_source set to 'canvas'", async () => {
    const { client, calls } = makeClient({
      canvas_connections: [{ data: { token_status: "ok" }, error: null }],
      canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }],
      class_assessments: [{ data: [{ id: "a-1", canvas_assignment_id: "assn-1", name: "Essay", date: "2026-09-20", points_earned: null, points_source: null }], error: null }],
    });
    fetchCanvasGradedAssignmentsMock.mockResolvedValue({ ok: true, data: [{ canvasAssignmentId: "assn-1", name: "Essay", dueAt: "2026-09-20T23:59:00Z", pointsPossible: 100, pointsEarned: 92, gradingType: "points" }] });

    const result = await syncCanvasGradesCore(client, "user-1", tz, now);

    expect(result).toEqual({ ok: true, graded: 1, staged: 0 });
    const update = calls.find((c) => c.table === "class_assessments" && c.method === "update")!;
    expect(update.args[0]).toEqual({ points_earned: 92, points_possible: 100, points_source: "canvas" });
  });

  it("case (a): NEVER overwrites a grade that isn't Canvas-sourced (points_earned set, points_source null)", async () => {
    const { client, calls } = makeClient({
      canvas_connections: [{ data: { token_status: "ok" }, error: null }],
      canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }],
      class_assessments: [{ data: [{ id: "a-1", canvas_assignment_id: "assn-1", name: "Essay", date: "2026-09-20", points_earned: 100, points_source: null }], error: null }],
    });
    fetchCanvasGradedAssignmentsMock.mockResolvedValue({ ok: true, data: [{ canvasAssignmentId: "assn-1", name: "Essay", dueAt: "2026-09-20T23:59:00Z", pointsPossible: 100, pointsEarned: 92, gradingType: "points" }] });

    const result = await syncCanvasGradesCore(client, "user-1", tz, now);

    expect(result).toEqual({ ok: true, graded: 0, staged: 0 });
    expect(calls.some((c) => c.table === "class_assessments" && c.method === "update")).toBe(false);
  });

  it("case (a): DOES overwrite a grade previously written by Canvas sync (points_source='canvas')", async () => {
    const { client, calls } = makeClient({
      canvas_connections: [{ data: { token_status: "ok" }, error: null }],
      canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }],
      class_assessments: [{ data: [{ id: "a-1", canvas_assignment_id: "assn-1", name: "Essay", date: "2026-09-20", points_earned: 80, points_source: "canvas" }], error: null }],
    });
    fetchCanvasGradedAssignmentsMock.mockResolvedValue({ ok: true, data: [{ canvasAssignmentId: "assn-1", name: "Essay", dueAt: "2026-09-20T23:59:00Z", pointsPossible: 100, pointsEarned: 92, gradingType: "points" }] });

    await syncCanvasGradesCore(client, "user-1", tz, now);

    const update = calls.find((c) => c.table === "class_assessments" && c.method === "update")!;
    expect(update.args[0]).toMatchObject({ points_earned: 92, points_source: "canvas" });
  });

  it("case (b): an unlinked assessment with an exact normalized-title match gets linked and graded", async () => {
    const { client, calls } = makeClient({
      canvas_connections: [{ data: { token_status: "ok" }, error: null }],
      canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }],
      class_assessments: [{ data: [{ id: "a-1", canvas_assignment_id: null, name: "  Essay 1  ", date: "2026-09-01", points_earned: null, points_source: null }], error: null }],
      staging_batches: [{ data: [], error: null }],
    });
    fetchCanvasGradedAssignmentsMock.mockResolvedValue({ ok: true, data: [{ canvasAssignmentId: "assn-9", name: "essay 1", dueAt: "2026-09-20T23:59:00Z", pointsPossible: 100, pointsEarned: 88, gradingType: "points" }] });

    const result = await syncCanvasGradesCore(client, "user-1", tz, now);

    expect(result).toEqual({ ok: true, graded: 1, staged: 0 });
    const update = calls.find((c) => c.table === "class_assessments" && c.method === "update")!;
    expect(update.args[0]).toEqual({ canvas_assignment_id: "assn-9", points_earned: 88, points_possible: 100, points_source: "canvas" });
  });

  it("case (c): two equally-titled unlinked assessments is ambiguous -- stages instead of guessing", async () => {
    const { client } = makeClient({
      canvas_connections: [{ data: { token_status: "ok" }, error: null }],
      canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }],
      class_assessments: [
        {
          data: [
            { id: "a-1", canvas_assignment_id: null, name: "Quiz", date: "2026-09-01", points_earned: null, points_source: null },
            { id: "a-2", canvas_assignment_id: null, name: "Quiz", date: "2026-09-08", points_earned: null, points_source: null },
          ],
          error: null,
        },
      ],
      staging_batches: [{ data: [], error: null }],
    });
    fetchCanvasGradedAssignmentsMock.mockResolvedValue({ ok: true, data: [{ canvasAssignmentId: "assn-5", name: "Quiz", dueAt: null, pointsPossible: 10, pointsEarned: 9, gradingType: "points" }] });

    const result = await syncCanvasGradesCore(client, "user-1", tz, now);

    expect(result).toEqual({ ok: true, graded: 0, staged: 1 });
    // Regression (P3-13): the assignment ID must land in the 7th param
    // (canvas_assignment_id), NOT the 6th (canvas_announcement_id) --
    // see staging-core.ts's own header for the bug this call site used to have.
    expect(createStagingBatchCoreMock).toHaveBeenCalledWith(client, "user-1", "class-1", "canvas_assignment", undefined, undefined, "assn-5");
    expect(createStagedDeliverablesCoreMock).toHaveBeenCalledWith(client, "user-1", "batch-new", [
      { name: "Quiz", type: "homework_assignment", date: null, confidence: 1, sourceSnippet: null },
    ]);
  });

  it("case (c) TOMBSTONE (Opus Lead ruling): an assignment already staged -- pending OR previously rejected, indistinguishable from here -- is never re-staged", async () => {
    const { client } = makeClient({
      canvas_connections: [{ data: { token_status: "ok" }, error: null }],
      canvas_course_mappings: [{ data: [{ canvas_course_id: "10", class_id: "class-1" }], error: null }],
      class_assessments: [{ data: [], error: null }], // no local assessment exists at all (matches nothing)
      // The batch row (and its canvas_assignment_id marker) survives a reject
      // -- rejecting only deletes the child staged_deliverables row -- so this
      // pre-filter query still finds it regardless of whether the batch is
      // still pending review or was fully rejected.
      staging_batches: [{ data: [{ canvas_assignment_id: "assn-already-staged" }], error: null }],
    });
    fetchCanvasGradedAssignmentsMock.mockResolvedValue({ ok: true, data: [{ canvasAssignmentId: "assn-already-staged", name: "Reading Response", dueAt: null, pointsPossible: 10, pointsEarned: 8, gradingType: "points" }] });

    const result = await syncCanvasGradesCore(client, "user-1", tz, now);

    expect(result).toEqual({ ok: true, graded: 0, staged: 0 });
    expect(createStagingBatchCoreMock).not.toHaveBeenCalled();
    expect(createStagedDeliverablesCoreMock).not.toHaveBeenCalled();
  });
});

// CANVAS-LITE-02: processCanvasAssignment is now the shared per-assignment
// decision function reused by both syncCanvasGradesCore's own loop (proven
// unmodified above) AND the new agent bulk-import path
// (lib/canvas/agent-import-core.ts) -- these tests assert the outcome
// discriminant values directly, since agent-import-core.ts's per-item
// PerItemOutcome mapping depends on them exactly.
describe("processCanvasAssignment (CANVAS-LITE-02 extraction)", () => {
  function makeState(overrides: Partial<CanvasAssignmentSyncState> = {}): CanvasAssignmentSyncState {
    return { byCanvasId: new Map(), unlinked: [], alreadyStagedAssignmentIds: new Set(), ...overrides };
  }

  it('returns {outcome:"graded", via:"linked"} and updates when an already-linked assessment can be overwritten', async () => {
    const { client, calls } = makeClient({});
    const linked = { id: "a-1", canvasAssignmentId: "assn-1", name: "Essay", date: "2026-09-20", pointsEarned: null, pointsSource: null };
    const state = makeState({ byCanvasId: new Map([["assn-1", linked]]) });

    const outcome = await processCanvasAssignment(
      client,
      "user-1",
      "class-1",
      tz,
      { canvasAssignmentId: "assn-1", name: "Essay", dueAt: "2026-09-20T23:59:00Z", pointsPossible: 100, pointsEarned: 92, gradingType: "points" },
      state,
    );

    expect(outcome).toEqual({ outcome: "graded", via: "linked" });
    expect(calls.find((c) => c.table === "class_assessments" && c.method === "update")!.args[0]).toEqual({
      points_earned: 92,
      points_possible: 100,
      points_source: "canvas",
    });
  });

  it('returns {outcome:"protected", via:"linked"} and never writes when the existing grade is not Canvas-sourced', async () => {
    const { client, calls } = makeClient({});
    const linked = { id: "a-1", canvasAssignmentId: "assn-1", name: "Essay", date: "2026-09-20", pointsEarned: 100, pointsSource: null };
    const state = makeState({ byCanvasId: new Map([["assn-1", linked]]) });

    const outcome = await processCanvasAssignment(
      client,
      "user-1",
      "class-1",
      tz,
      { canvasAssignmentId: "assn-1", name: "Essay", dueAt: "2026-09-20T23:59:00Z", pointsPossible: 100, pointsEarned: 92, gradingType: "points" },
      state,
    );

    expect(outcome).toEqual({ outcome: "protected", via: "linked" });
    expect(calls.some((c) => c.table === "class_assessments" && c.method === "update")).toBe(false);
  });

  it('returns {outcome:"staged"} and removes nothing from unlinked when no unambiguous match exists', async () => {
    const { client } = makeClient({});
    const state = makeState({ unlinked: [{ id: "a-1", canvasAssignmentId: null, name: "Quiz A", date: "2026-09-01", pointsEarned: null, pointsSource: null }] });

    const outcome = await processCanvasAssignment(
      client,
      "user-1",
      "class-1",
      tz,
      { canvasAssignmentId: "assn-9", name: "Totally Different Title", dueAt: null, pointsPossible: 10, pointsEarned: 9, gradingType: "points" },
      state,
    );

    expect(outcome).toEqual({ outcome: "staged" });
    expect(state.unlinked).toHaveLength(1);
  });

  it('returns {outcome:"skipped", reason:"already_staged"} without staging again', async () => {
    const { client } = makeClient({});
    const state = makeState({ alreadyStagedAssignmentIds: new Set(["assn-already"]) });

    const outcome = await processCanvasAssignment(
      client,
      "user-1",
      "class-1",
      tz,
      { canvasAssignmentId: "assn-already", name: "Reading Response", dueAt: null, pointsPossible: 10, pointsEarned: 8, gradingType: "points" },
      state,
    );

    expect(outcome).toEqual({ outcome: "skipped", reason: "already_staged" });
    expect(createStagingBatchCoreMock).not.toHaveBeenCalled();
  });

  it('mutates state.unlinked in place on a matched grade, so a second call in the same batch cannot double-claim it', async () => {
    const { client } = makeClient({});
    const target = { id: "a-1", canvasAssignmentId: null, name: "Essay 1", date: "2026-09-01", pointsEarned: null, pointsSource: null };
    const state = makeState({ unlinked: [target] });

    const first = await processCanvasAssignment(client, "user-1", "class-1", tz, { canvasAssignmentId: "assn-1", name: "essay 1", dueAt: null, pointsPossible: 100, pointsEarned: 88, gradingType: "points" }, state);
    expect(first).toEqual({ outcome: "graded", via: "matched" });
    expect(state.unlinked).toHaveLength(0);

    const second = await processCanvasAssignment(client, "user-1", "class-1", tz, { canvasAssignmentId: "assn-2", name: "essay 1", dueAt: null, pointsPossible: 50, pointsEarned: 40, gradingType: "points" }, state);
    expect(second).toEqual({ outcome: "staged" });
  });
});

// CANVAS-GAP-03: the never-overwrite guard and the points-comparable
// guard are independent -- an ungradable type must never write a grade
// regardless of whether the existing local row could otherwise be
// overwritten, and a linkable-but-ungradable assignment still gets
// LINKED (so a later regrade to a comparable type, or a hand-entered
// grade, both work normally) -- it just never gets graded from this data.
describe("processCanvasAssignment — CANVAS-GAP-03 grading_type guard", () => {
  function makeState(overrides: Partial<CanvasAssignmentSyncState> = {}): CanvasAssignmentSyncState {
    return { byCanvasId: new Map(), unlinked: [], alreadyStagedAssignmentIds: new Set(), ...overrides };
  }

  it.each(["pass_fail", "letter_grade", "gpa_scale", null])(
    'returns {outcome:"ungradable", via:"linked"} for grading_type %s on an already-linked assessment, and never writes points',
    async (gradingType) => {
      const { client, calls } = makeClient({});
      const linked = { id: "a-1", canvasAssignmentId: "assn-1", name: "Essay", date: "2026-09-20", pointsEarned: null, pointsSource: null };
      const state = makeState({ byCanvasId: new Map([["assn-1", linked]]) });

      const outcome = await processCanvasAssignment(client, "user-1", "class-1", tz, { canvasAssignmentId: "assn-1", name: "Essay", dueAt: null, pointsPossible: 100, pointsEarned: 92, gradingType }, state);

      expect(outcome).toEqual({ outcome: "ungradable", via: "linked" });
      expect(calls.some((c) => c.table === "class_assessments" && c.method === "update")).toBe(false);
    },
  );

  it('returns {outcome:"ungradable", via:"matched"} and STILL LINKS (but never grades) an unambiguous match with a non-points-comparable grading_type', async () => {
    const { client, calls } = makeClient({});
    const target = { id: "a-1", canvasAssignmentId: null, name: "Essay 1", date: "2026-09-01", pointsEarned: null, pointsSource: null };
    const state = makeState({ unlinked: [target] });

    const outcome = await processCanvasAssignment(
      client,
      "user-1",
      "class-1",
      tz,
      { canvasAssignmentId: "assn-1", name: "essay 1", dueAt: null, pointsPossible: 100, pointsEarned: 88, gradingType: "pass_fail" },
      state,
    );

    expect(outcome).toEqual({ outcome: "ungradable", via: "matched" });
    const update = calls.find((c) => c.table === "class_assessments" && c.method === "update")!;
    expect(update.args[0]).toEqual({ canvas_assignment_id: "assn-1" }); // linked, but no points_* fields at all
    expect(state.unlinked).toHaveLength(0); // still claimed, so it can't also be staged as a duplicate
  });

  it('"ungradable" wins over the never-overwrite guard question entirely -- a null/unrecognized grading_type never writes points even when the existing grade IS overwritable', async () => {
    const { client, calls } = makeClient({});
    // pointsEarned: null, pointsSource: null -- canOverwriteGrade would be TRUE here; the point of this test is that gradability is checked independently and wins.
    const linked = { id: "a-1", canvasAssignmentId: "assn-1", name: "Essay", date: "2026-09-20", pointsEarned: null, pointsSource: null };
    const state = makeState({ byCanvasId: new Map([["assn-1", linked]]) });

    const outcome = await processCanvasAssignment(client, "user-1", "class-1", tz, { canvasAssignmentId: "assn-1", name: "Essay", dueAt: null, pointsPossible: 100, pointsEarned: 92, gradingType: null }, state);

    expect(outcome).toEqual({ outcome: "ungradable", via: "linked" });
    expect(calls.some((c) => c.table === "class_assessments")).toBe(false);
  });

  it("points and percent are both gradable -- the guard is an allowlist of exactly two types, not just 'has some grading_type'", async () => {
    const { client } = makeClient({});
    const linkedPoints = { id: "a-1", canvasAssignmentId: "assn-1", name: "Essay", date: "2026-09-20", pointsEarned: null, pointsSource: null };
    const statePoints = makeState({ byCanvasId: new Map([["assn-1", linkedPoints]]) });
    const outcomePoints = await processCanvasAssignment(client, "user-1", "class-1", tz, { canvasAssignmentId: "assn-1", name: "Essay", dueAt: null, pointsPossible: 100, pointsEarned: 92, gradingType: "points" }, statePoints);
    expect(outcomePoints).toEqual({ outcome: "graded", via: "linked" });

    const linkedPercent = { id: "a-2", canvasAssignmentId: "assn-2", name: "Quiz", date: "2026-09-20", pointsEarned: null, pointsSource: null };
    const statePercent = makeState({ byCanvasId: new Map([["assn-2", linkedPercent]]) });
    const outcomePercent = await processCanvasAssignment(client, "user-1", "class-1", tz, { canvasAssignmentId: "assn-2", name: "Quiz", dueAt: null, pointsPossible: 20, pointsEarned: 18, gradingType: "percent" }, statePercent);
    expect(outcomePercent).toEqual({ outcome: "graded", via: "linked" });
  });
});
