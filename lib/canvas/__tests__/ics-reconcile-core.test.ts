import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const getMappedCoursesMock = vi.fn();
// Real `findUnambiguousLocalMatch` (and its `normalizeTitle` internals) is
// kept via importActual -- this suite exists specifically to prove the
// SAME function grade sync uses is reused here, not just that it's called.
vi.mock("@/lib/canvas/sync-core", async () => {
  const actual = await vi.importActual<typeof import("@/lib/canvas/sync-core")>("@/lib/canvas/sync-core");
  return { ...actual, getMappedCourses: (...args: unknown[]) => getMappedCoursesMock(...args) };
});

const createStagingBatchCoreMock = vi.fn(async (..._args: unknown[]) => "batch-new");
const createStagedDeliverablesCoreMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/school/staging-core", () => ({
  createStagingBatchCore: (...args: unknown[]) => createStagingBatchCoreMock(...args),
  createStagedDeliverablesCore: (...args: unknown[]) => createStagedDeliverablesCoreMock(...args),
}));

const { reconcileCanvasIcsCore } = await import("../ics-reconcile-core");

type Resp = { data: unknown; error: unknown };
function makeClient(responses: Record<string, Resp[]>) {
  const queues: Record<string, Resp[]> = Object.fromEntries(Object.entries(responses).map(([k, v]) => [k, [...v]]));
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "update"]) chain[method] = vi.fn(() => chain);
    const resolve = (): Resp => (queues[table] ?? []).shift() ?? { data: [], error: null };
    chain.then = (res: (v: Resp) => void) => res(resolve());
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient };
}

const tz = "America/Chicago";

function feedWith(events: { assignmentId: string; courseId: string; summary: string; dtstart: string }[]): string {
  const blocks = events.map(
    (e) => `BEGIN:VEVENT\r\nUID:event-${e.assignmentId}@canvas.instructure.com\r\nDTSTART:${e.dtstart}\r\nSUMMARY:${e.summary}\r\nURL:https://school.instructure.com/courses/${e.courseId}/assignments/${e.assignmentId}\r\nEND:VEVENT`,
  );
  return `BEGIN:VCALENDAR\r\n${blocks.join("\r\n")}\r\nEND:VCALENDAR`;
}

beforeEach(() => {
  getMappedCoursesMock.mockReset();
  createStagingBatchCoreMock.mockClear();
  createStagedDeliverablesCoreMock.mockClear();
  getMappedCoursesMock.mockResolvedValue([{ canvasCourseId: "10", classId: "class-1" }]);
});

describe("reconcileCanvasIcsCore (P3-13)", () => {
  it("an assignment event with no local link, no staged marker, and no matching local assessment gets staged (never auto-created)", async () => {
    const { client } = makeClient({ class_assessments: [{ data: [], error: null }], staging_batches: [{ data: [], error: null }] });
    const result = await reconcileCanvasIcsCore(client, "user-1", tz, feedWith([{ assignmentId: "42", courseId: "10", summary: "Essay 2", dtstart: "20261005T235900Z" }]));

    expect(result).toEqual({ parsedAssignmentEvents: 1, alreadyCovered: 0, linkedToExisting: 0, unmapped: 0, newlyStaged: 1 });
    expect(createStagingBatchCoreMock).toHaveBeenCalledWith(client, "user-1", "class-1", "canvas_assignment", undefined, undefined, "42");
    expect(createStagedDeliverablesCoreMock).toHaveBeenCalledWith(client, "user-1", "batch-new", [{ name: "Essay 2", type: "homework_assignment", date: "2026-10-05", confidence: 1, sourceSnippet: null }]);
  });

  it("an assignment already LINKED (class_assessments.canvas_assignment_id) is skipped, not re-staged", async () => {
    const { client } = makeClient({ class_assessments: [{ data: [{ canvas_assignment_id: "42" }], error: null }], staging_batches: [{ data: [], error: null }] });
    const result = await reconcileCanvasIcsCore(client, "user-1", tz, feedWith([{ assignmentId: "42", courseId: "10", summary: "Essay 2", dtstart: "20261005T235900Z" }]));

    expect(result).toEqual({ parsedAssignmentEvents: 1, alreadyCovered: 1, linkedToExisting: 0, unmapped: 0, newlyStaged: 0 });
    expect(createStagingBatchCoreMock).not.toHaveBeenCalled();
  });

  it("TOMBSTONE: an assignment already staged (pending or previously rejected -- both leave the marker) is never re-staged", async () => {
    const { client } = makeClient({ class_assessments: [{ data: [], error: null }], staging_batches: [{ data: [{ canvas_assignment_id: "42" }], error: null }] });
    const result = await reconcileCanvasIcsCore(client, "user-1", tz, feedWith([{ assignmentId: "42", courseId: "10", summary: "Essay 2", dtstart: "20261005T235900Z" }]));

    expect(result).toEqual({ parsedAssignmentEvents: 1, alreadyCovered: 1, linkedToExisting: 0, unmapped: 0, newlyStaged: 0 });
    expect(createStagingBatchCoreMock).not.toHaveBeenCalled();
  });

  it("an assignment in an UNMAPPED course is counted, not staged (can't stage without a local class)", async () => {
    const { client } = makeClient({ class_assessments: [{ data: [], error: null }], staging_batches: [{ data: [], error: null }] });
    const result = await reconcileCanvasIcsCore(client, "user-1", tz, feedWith([{ assignmentId: "42", courseId: "20", summary: "Essay 2", dtstart: "20261005T235900Z" }]));

    expect(result).toEqual({ parsedAssignmentEvents: 1, alreadyCovered: 0, linkedToExisting: 0, unmapped: 1, newlyStaged: 0 });
    expect(createStagingBatchCoreMock).not.toHaveBeenCalled();
  });

  it("non-assignment calendar events (no /courses/<id>/assignments/<id> URL) are filtered out before any DB query", async () => {
    const { client } = makeClient({});
    const feed = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Guest lecture\r\nURL:https://school.instructure.com/courses/10/calendar_events/99\r\nEND:VEVENT\r\nEND:VCALENDAR";
    const result = await reconcileCanvasIcsCore(client, "user-1", tz, feed);

    expect(result).toEqual({ parsedAssignmentEvents: 0, alreadyCovered: 0, linkedToExisting: 0, unmapped: 0, newlyStaged: 0 });
    expect(getMappedCoursesMock).not.toHaveBeenCalled();
  });

  it("an empty feed produces a zeroed result with no DB queries at all", async () => {
    const { client } = makeClient({});
    const result = await reconcileCanvasIcsCore(client, "user-1", tz, "BEGIN:VCALENDAR\r\nEND:VCALENDAR");
    expect(result).toEqual({ parsedAssignmentEvents: 0, alreadyCovered: 0, linkedToExisting: 0, unmapped: 0, newlyStaged: 0 });
    expect(getMappedCoursesMock).not.toHaveBeenCalled();
  });

  /**
   * The Lead's explicit follow-up instruction: reuse the SAME
   * unambiguous-match rule grade sync uses (lib/canvas/sync-core.ts's
   * `findUnambiguousLocalMatch`) so a user-typed assessment the REST sync
   * never encountered gets LINKED here instead of producing a rejectable
   * staged duplicate.
   */
  it("an unambiguous exact-title match against an unlinked local assessment LINKS it, never stages a duplicate", async () => {
    const { client } = makeClient({
      class_assessments: [{ data: [{ id: "local-1", canvas_assignment_id: null, name: "  Essay 2  ", date: "2026-09-01", points_earned: null, points_source: null }], error: null }],
      staging_batches: [{ data: [], error: null }],
    });
    const result = await reconcileCanvasIcsCore(client, "user-1", tz, feedWith([{ assignmentId: "42", courseId: "10", summary: "essay 2", dtstart: "20261005T235900Z" }]));

    expect(result).toEqual({ parsedAssignmentEvents: 1, alreadyCovered: 0, linkedToExisting: 1, unmapped: 0, newlyStaged: 0 });
    expect(createStagingBatchCoreMock).not.toHaveBeenCalled();
  });

  it("two equally-titled unlinked local assessments is ambiguous -- stages instead of guessing (same posture as grade sync's own case (c))", async () => {
    const { client } = makeClient({
      class_assessments: [
        {
          data: [
            { id: "local-1", canvas_assignment_id: null, name: "Quiz", date: "2026-09-01", points_earned: null, points_source: null },
            { id: "local-2", canvas_assignment_id: null, name: "Quiz", date: "2026-09-08", points_earned: null, points_source: null },
          ],
          error: null,
        },
      ],
      staging_batches: [{ data: [], error: null }],
    });
    const result = await reconcileCanvasIcsCore(client, "user-1", tz, feedWith([{ assignmentId: "42", courseId: "10", summary: "Quiz", dtstart: "20261005T235900Z" }]));

    expect(result.linkedToExisting).toBe(0);
    expect(result.newlyStaged).toBe(1);
    expect(createStagingBatchCoreMock).toHaveBeenCalled();
  });
});
