import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeDb } from "@/lib/self-mastery/ingestion/__tests__/fake-db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/gateway", () => ({ gatewayChat: vi.fn() }));
vi.mock("@/lib/canvas/sync-core", async () => {
  const actual = await vi.importActual<typeof import("@/lib/canvas/sync-core")>("@/lib/canvas/sync-core");
  return { ...actual, getMappedCourses: async () => [{ canvasCourseId: "10", classId: "class-1" }] };
});
vi.mock("@/lib/canvas/course-auto-import-core", () => ({
  autoImportCanvasCoursesAsClassesCore: async () => ({ created: 0, adopted: 0, alreadyLinked: 1, skippedDismissed: 0 }),
}));

const { reconcileCanvasIcsCore } = await import("../ics-reconcile-core");
const TZ = "America/Chicago";
const USER = "user-1";

function feed(events: { id: string; summary: string; dtstart: string }[]): string {
  const blocks = events.map(
    (e) => `BEGIN:VEVENT\r\nUID:event-${e.id}@canvas.instructure.com\r\nDTSTART:${e.dtstart}\r\nSUMMARY:${e.summary}\r\nURL:https://school.instructure.com/courses/10/assignments/${e.id}\r\nEND:VEVENT`,
  );
  return `BEGIN:VCALENDAR\r\n${blocks.join("\r\n")}\r\nEND:VCALENDAR`;
}
// 11:59 PM Central on the given date (Canvas due times) = 05:59 UTC next day.
const OCT30 = "20261031T045900Z";
const NOV2 = "20261103T055900Z";

const assessment = (over: Record<string, unknown> = {}) => ({
  id: "a1", user_id: USER, class_id: "class-1", canvas_assignment_id: "501", name: "Homework 4 [CS 3345]", date: "2026-10-30", type: "homework_assignment", points_earned: null, points_source: null, ...over,
});
const world = (extra: Record<string, Record<string, unknown>[]> = {}) =>
  makeFakeDb({ class_assessments: [assessment()], staging_batches: [], staged_deliverables: [], ...extra });

beforeEach(() => vi.clearAllMocks());

describe("ICS reconcile — a due date that moves in Canvas is picked up (FIX 3)", () => {
  it("THE CASE: an assignment moved from Oct 30 to Nov 2 stages a change for the person to confirm, and the stored date is NOT overwritten", async () => {
    const d = world();
    const r = await reconcileCanvasIcsCore(d.client, USER, TZ, feed([{ id: "501", summary: "Homework 4 [CS 3345]", dtstart: NOV2 }]));
    expect(r.rescheduleStaged).toBe(1);
    expect(d.tables.class_assessments![0]!.date).toBe("2026-10-30"); // never silent
    const batch = d.tables.staging_batches![0]!;
    expect(batch).toMatchObject({ class_id: "class-1", source: "announcement", user_id: USER });
    expect(String(batch.raw_text)).toMatch(/moved from 2026-10-30 to 2026-11-02/);
    const staged = d.tables.staged_deliverables![0]!;
    expect(staged).toMatchObject({ date: "2026-11-02", replaces_assessment_id: "a1", name: "Homework 4 [CS 3345]", type: "homework_assignment" });
  });

  it("the same date in the feed stages nothing", async () => {
    const d = world();
    const r = await reconcileCanvasIcsCore(d.client, USER, TZ, feed([{ id: "501", summary: "Homework 4 [CS 3345]", dtstart: OCT30 }]));
    expect(r.rescheduleStaged).toBe(0);
    expect(d.tables.staging_batches).toHaveLength(0);
  });

  it("running it again does not stage the same change twice, even after the person confirmed or rejected it (the batch is the tombstone)", async () => {
    const d = world();
    const f = feed([{ id: "501", summary: "Homework 4 [CS 3345]", dtstart: NOV2 }]);
    await reconcileCanvasIcsCore(d.client, USER, TZ, f);
    await reconcileCanvasIcsCore(d.client, USER, TZ, f);
    expect(d.tables.staging_batches).toHaveLength(1);
    // the person rejects the change: only the child row goes, the batch stays
    d.tables.staged_deliverables!.length = 0;
    await reconcileCanvasIcsCore(d.client, USER, TZ, f);
    expect(d.tables.staging_batches).toHaveLength(1);
    expect(d.tables.staged_deliverables).toHaveLength(0);
  });

  it("if the date moves AGAIN while the first change is still pending, the pending change is updated in place (no second change)", async () => {
    const d = world();
    await reconcileCanvasIcsCore(d.client, USER, TZ, feed([{ id: "501", summary: "Homework 4 [CS 3345]", dtstart: NOV2 }]));
    const NOV5 = "20261106T055900Z";
    const r = await reconcileCanvasIcsCore(d.client, USER, TZ, feed([{ id: "501", summary: "Homework 4 [CS 3345]", dtstart: NOV5 }]));
    expect(r.rescheduleStaged).toBe(0);
    expect(r.stagedDateUpdated).toBe(1);
    expect(d.tables.staged_deliverables).toHaveLength(1);
    expect(d.tables.staged_deliverables![0]!.date).toBe("2026-11-05");
  });

  it("an assignment still PENDING in staging (not yet confirmed) whose date moved gets its staged date updated in place", async () => {
    const d = world({
      class_assessments: [],
      staging_batches: [{ id: "sb1", user_id: USER, class_id: "class-1", status: "pending", source: "canvas_assignment", canvas_assignment_id: "777" }],
      staged_deliverables: [{ id: "sd1", user_id: USER, batch_id: "sb1", name: "Quiz 2", type: "quiz", date: "2026-10-30", committed_assessment_id: null }],
    });
    const r = await reconcileCanvasIcsCore(d.client, USER, TZ, feed([{ id: "777", summary: "Quiz 2 [CS 3345]", dtstart: NOV2 }]));
    expect(r.stagedDateUpdated).toBe(1);
    expect(d.tables.staged_deliverables![0]!.date).toBe("2026-11-02");
    expect(d.tables.staging_batches).toHaveLength(1);
  });

  it("an already-CONFIRMED staged assignment is left alone here (its assessment is what carries the date)", async () => {
    const d = world({
      class_assessments: [],
      staging_batches: [{ id: "sb1", user_id: USER, class_id: "class-1", status: "confirmed", source: "canvas_assignment", canvas_assignment_id: "777" }],
      staged_deliverables: [{ id: "sd1", user_id: USER, batch_id: "sb1", name: "Quiz 2", type: "quiz", date: "2026-10-30", committed_assessment_id: "a9" }],
    });
    const r = await reconcileCanvasIcsCore(d.client, USER, TZ, feed([{ id: "777", summary: "Quiz 2", dtstart: NOV2 }]));
    expect(r.stagedDateUpdated).toBe(0);
    expect(d.tables.staged_deliverables![0]!.date).toBe("2026-10-30");
  });

  it("a feed event with no usable date never stages a change", async () => {
    const d = world();
    const noDate = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e@canvas.instructure.com\r\nSUMMARY:Homework 4 [CS 3345]\r\nURL:https://school.instructure.com/courses/10/assignments/501\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const r = await reconcileCanvasIcsCore(d.client, USER, TZ, noDate);
    expect(r.rescheduleStaged).toBe(0);
  });
});
