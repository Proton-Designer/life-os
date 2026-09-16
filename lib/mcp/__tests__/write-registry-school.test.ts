import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWriteAction, listWriteEntities, listWriteActions } from "../write-registry";

function textOf(outcome: Awaited<ReturnType<NonNullable<ReturnType<typeof getWriteAction>>["handler"]>>) {
  const block = outcome.result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return JSON.parse(block.text);
}

/**
 * A per-table fake client. `maybeSingleSeq`/`singleSeq` are FIFO queues per
 * table — school's handlers often make two sequential calls against the
 * SAME table with different expected rows (e.g. `task.toggle`'s
 * `assertRowDomain` domain-check maybeSingle, then `toggleTaskCore`'s own
 * completed-state maybeSingle) — a single static mock per table cannot
 * distinguish them, so each call shifts the next queued response.
 */
function makeClient(opts: { maybeSingleSeq?: Record<string, unknown[]>; singleSeq?: Record<string, unknown[]> } = {}) {
  const maybeSingleSeq: Record<string, unknown[]> = Object.fromEntries(Object.entries(opts.maybeSingleSeq ?? {}).map(([k, v]) => [k, [...v]]));
  const singleSeq: Record<string, unknown[]> = Object.fromEntries(Object.entries(opts.singleSeq ?? {}).map(([k, v]) => [k, [...v]]));
  const calls: Record<string, { insert: Record<string, unknown>[]; update: Record<string, unknown>[]; upsert: Record<string, unknown>[]; delete: number; eq: unknown[][] }> = {};

  const from = vi.fn((table: string) => {
    calls[table] ??= { insert: [], update: [], upsert: [], delete: 0, eq: [] };
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((...args: unknown[]) => {
      calls[table].eq.push(args);
      return chain;
    });
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.not = vi.fn(() => chain);
    chain.in = vi.fn(() => chain);
    chain.insert = vi.fn((row: Record<string, unknown>) => {
      calls[table].insert.push(row);
      return chain;
    });
    chain.update = vi.fn((row: Record<string, unknown>) => {
      calls[table].update.push(row);
      return chain;
    });
    chain.delete = vi.fn(() => {
      calls[table].delete++;
      return chain;
    });
    chain.upsert = vi.fn((row: Record<string, unknown>) => {
      calls[table].upsert.push(row);
      return { then: (resolve: (v: { error: null }) => void) => resolve({ error: null }) };
    });
    chain.maybeSingle = vi.fn(async () => ({ data: (maybeSingleSeq[table] ?? []).shift() ?? null, error: null }));
    chain.single = vi.fn(async () => ({ data: (singleSeq[table] ?? []).shift() ?? { id: "new-id" }, error: null }));
    chain.then = (resolve: (v: { error: null }) => void) => resolve({ error: null });
    return chain;
  });

  return { client: { from } as unknown as SupabaseClient, calls };
}

const now = new Date("2026-09-08T20:00:00.000Z");

describe("write-registry — school dispatch shape", () => {
  it("school has exactly task/class/class_assessment/schedule_event/question/grade_category/staging/practice_test/canvas_import", () => {
    // P4-08 added question/grade_category/staging (write-coverage widening)
    // and practice_test (a9-confirmed scope addition, reusing P2-09's cores).
    // CANVAS-LITE-02 added canvas_import (an external agent's bulk-import
    // workaround for a school that blocks Canvas access tokens).
    expect(listWriteEntities("school").sort()).toEqual([
      "canvas_import",
      "class",
      "class_assessment",
      "grade_category",
      "practice_test",
      "question",
      "schedule_event",
      "staging",
      "task",
    ]);
  });

  it("school.canvas_import has exactly run_batch", () => {
    expect(listWriteActions("school", "canvas_import").sort()).toEqual(["run_batch"]);
  });

  it("school.task has add/edit/toggle, never remove — removeTaskCore is a real DELETE", () => {
    expect(listWriteActions("school", "task").sort()).toEqual(["add", "edit", "toggle"]);
  });

  it("school.class has create/edit, never a syllabus action or remove", () => {
    expect(listWriteActions("school", "class").sort()).toEqual(["create", "edit"]);
  });

  it("school.class_assessment has add/edit, never remove — delete_class_assessment is a real DELETE", () => {
    expect(listWriteActions("school", "class_assessment").sort()).toEqual(["add", "edit"]);
  });

  it("school.schedule_event has exactly the THREE distinct recurrence writes -- edit_series/set_override/cancel_occurrence -- never create/remove/remove_override/uncancel", () => {
    expect(listWriteActions("school", "schedule_event").sort()).toEqual(["cancel_occurrence", "edit_series", "set_override"]);
  });
});

describe("school.task.add", () => {
  it("always writes domain:'school', regardless of what a caller might try to pass", async () => {
    const action = getWriteAction("school", "task", "add")!;
    const { client, calls } = makeClient({ singleSeq: { tasks: [{ id: "task-new" }] } });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { title: "Read chapter 4", due_date: "2026-09-10", task_type: "quiz" });

    expect(textOf(outcome)).toEqual({ id: "task-new" });
    expect(calls.tasks.insert[0]).toMatchObject({ domain: "school", title: "Read chapter 4", due_date: "2026-09-10", task_type: "quiz" });
  });

  it("REJECTS a missing title", async () => {
    const action = getWriteAction("school", "task", "add")!;
    const { client } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, {})).rejects.toThrow(/title/i);
  });

  it("REJECTS an invalid task_type, never silently coerced", async () => {
    const action = getWriteAction("school", "task", "add")!;
    const { client } = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { title: "x", task_type: "worry" }),
    ).rejects.toThrow(/task_type/i);
  });

  it.each([
    ["2026-09-08", "America/Chicago 18:59 local"],
    ["2026-09-09", "America/Chicago 19:01 local"],
    ["2026-09-09", "Asia/Tokyo"],
  ])("passes due_date through byte-for-byte no matter what ctx.now/timezone are (%s, %s)", async (dueDate) => {
    const action = getWriteAction("school", "task", "add")!;
    const { client, calls } = makeClient({ singleSeq: { tasks: [{ id: "task-new" }] } });

    await action.handler({ userClient: client, userId: "user-1", timezone: "Asia/Tokyo", now: new Date("2026-09-08T23:59:00.000Z") }, { title: "x", due_date: dueDate });

    expect(calls.tasks.insert[0]).toMatchObject({ due_date: dueDate });
  });
});

describe("school.task.edit", () => {
  it("REJECTS editing a row whose domain isn't 'school' -- the write-side domain guard (assertRowDomain)", async () => {
    const action = getWriteAction("school", "task", "edit")!;
    const { client } = makeClient({ maybeSingleSeq: { tasks: [{ domain: "co_op" }] } });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "task-1" }, { title: "x" }),
    ).rejects.toThrow(/domain boundary|domain "co_op"/i);
  });

  // Regression guard for the boundary lib/mcp/tool-input-error.ts's own doc
  // comment names explicitly: assertRowDomain's message interpolates a
  // DB-read `domain` value, so it must stay a plain Error -- if it were
  // ever converted to ToolInputError, tool-wrapper.ts would hand that
  // DB-read value straight back to the calling AI client.
  it("assertRowDomain's rejection is a plain Error, NOT a ToolInputError -- it reads a DB value and must stay behind the generic MCP error message", async () => {
    const { ToolInputError } = await import("../tool-input-error");
    const action = getWriteAction("school", "task", "edit")!;
    const { client } = makeClient({ maybeSingleSeq: { tasks: [{ domain: "co_op" }] } });
    try {
      await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "task-1" }, { title: "x" });
      expect.unreachable("expected assertRowDomain to reject");
    } catch (e) {
      expect(e).not.toBeInstanceOf(ToolInputError);
    }
  });

  it("REJECTS editing a row that doesn't exist for this user", async () => {
    const action = getWriteAction("school", "task", "edit")!;
    const { client } = makeClient({ maybeSingleSeq: { tasks: [null] } });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "task-1" }, { title: "x" }),
    ).rejects.toThrow(/no tasks row found/i);
  });

  it("edits a genuinely school-domain task", async () => {
    const action = getWriteAction("school", "task", "edit")!;
    // P4-08: MERGE semantics -- assertRowDomain's own domain-check maybeSingle,
    // THEN this handler's own existing-row read (same "tasks" table, FIFO
    // queue per makeClient's own header) before it merges the patch over it.
    const { client, calls } = makeClient({
      maybeSingleSeq: {
        tasks: [
          { domain: "school" },
          { title: "Old title", due_date: "2026-09-01", task_type: "homework_assignment", task_type_other_label: null, class_id: "class-1" },
        ],
      },
    });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "task-1" }, { title: "Renamed", due_date: "2026-09-12" });

    expect(textOf(outcome)).toEqual({ id: "task-1" });
    expect(calls.tasks.update[0]).toMatchObject({ title: "Renamed", due_date: "2026-09-12", class_id: "class-1" });
  });

  it("REJECTS when the top-level id is missing", async () => {
    const action = getWriteAction("school", "task", "edit")!;
    const { client } = makeClient();
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { title: "x" })).rejects.toThrow(/requires the top-level `id`/i);
  });
});

describe("school.task.toggle", () => {
  it("checks the domain guard BEFORE toggling, then flips completed", async () => {
    const action = getWriteAction("school", "task", "toggle")!;
    const { client, calls } = makeClient({ maybeSingleSeq: { tasks: [{ domain: "school" }, { completed: false }] } });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "task-1" }, {});

    expect(textOf(outcome)).toMatchObject({ id: "task-1", completed: true });
    expect(calls.tasks.update[0]).toMatchObject({ completed: true });
  });

  it("REJECTS toggling a co_op task through the school entity", async () => {
    const action = getWriteAction("school", "task", "toggle")!;
    const { client } = makeClient({ maybeSingleSeq: { tasks: [{ domain: "co_op" }] } });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "task-1" }, {})).rejects.toThrow(/domain/i);
  });
});

describe("school.class.create", () => {
  it("computes position server-side and returns the real id", async () => {
    const action = getWriteAction("school", "class", "create")!;
    const { client, calls } = makeClient({ maybeSingleSeq: { classes: [{ position: 4 }] }, singleSeq: { classes: [{ id: "class-new" }] } });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, { code: "CS-3341-HON", short_name: "DSA" });

    expect(textOf(outcome)).toEqual({ id: "class-new" });
    expect(calls.classes.insert[0]).toMatchObject({ code: "CS-3341-HON", short_name: "DSA", position: 5 });
  });

  it("REJECTS a missing code", async () => {
    const action = getWriteAction("school", "class", "create")!;
    const { client } = makeClient({ maybeSingleSeq: { classes: [null] } });
    await expect(action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now }, {})).rejects.toThrow(/code/i);
  });
});

describe("school.class.edit", () => {
  it("edits short_name/room/instructor. No domain guard needed -- classes isn't shared with another domain", async () => {
    const action = getWriteAction("school", "class", "edit")!;
    const { client, calls } = makeClient();

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "class-1" }, { room: "ENG 201" });

    expect(textOf(outcome)).toEqual({ id: "class-1" });
    expect(calls.classes.update[0]).toMatchObject({ room: "ENG 201" });
  });
});

describe("school.class_assessment.add", () => {
  it("creates the linked task, then the assessment, using the top-level id as the class id", async () => {
    const action = getWriteAction("school", "class_assessment", "add")!;
    const { client, calls } = makeClient({ singleSeq: { tasks: [{ id: "task-new" }], class_assessments: [{ id: "assessment-new" }] } });

    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now, id: "class-1" },
      { name: "Midterm 2", type: "final_midterm", date: "2026-10-15" },
    );

    expect(textOf(outcome)).toEqual({ id: "assessment-new", taskId: "task-new" });
    expect(calls.tasks.insert[0]).toMatchObject({ domain: "school", class_id: "class-1", due_date: "2026-10-15" });
    expect(calls.class_assessments.insert[0]).toMatchObject({ class_id: "class-1", name: "Midterm 2", type: "final_midterm" });
  });

  it("REJECTS an invalid assessment type", async () => {
    const action = getWriteAction("school", "class_assessment", "add")!;
    const { client } = makeClient();
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "class-1" }, { name: "x", type: "homework", date: "2026-10-15" }),
    ).rejects.toThrow(/type/i);
  });
});

describe("school.class_assessment.edit", () => {
  it("edits the assessment and syncs its linked task", async () => {
    const action = getWriteAction("school", "class_assessment", "edit")!;
    const { client, calls } = makeClient({ singleSeq: { class_assessments: [{ task_id: "task-1" }] } });

    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now, id: "assessment-1" },
      { name: "Renamed", type: "exam", date: "2026-10-20" },
    );

    expect(textOf(outcome)).toEqual({ id: "assessment-1" });
    expect(calls.class_assessments.update[0]).toMatchObject({ name: "Renamed", type: "exam", date: "2026-10-20" });
    expect(calls.tasks.update[0]).toMatchObject({ title: "Renamed", due_date: "2026-10-20", task_type: "exam" });
  });

  /** P2-21: providing points_earned via MCP is a real user-edit path -- must clear points_source, same as the UI's own updateClassAssessmentCore call. */
  it("providing points_earned clears points_source (P2-21 never-overwrite invariant)", async () => {
    const action = getWriteAction("school", "class_assessment", "edit")!;
    const { client, calls } = makeClient({ singleSeq: { class_assessments: [{ task_id: null }] } });

    await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now, id: "assessment-1" },
      { name: "Essay 1", type: "quiz", date: "2026-10-20", points_earned: 87 },
    );

    expect(calls.class_assessments.update[0]).toEqual({ name: "Essay 1", type: "quiz", date: "2026-10-20", points_earned: 87, points_source: null });
  });

  it("omitting points_earned leaves it (and points_source) untouched", async () => {
    const action = getWriteAction("school", "class_assessment", "edit")!;
    const { client, calls } = makeClient({ singleSeq: { class_assessments: [{ task_id: null }] } });

    await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "assessment-1" }, { name: "Essay 1", type: "quiz", date: "2026-10-20" });

    expect(calls.class_assessments.update[0]).not.toHaveProperty("points_earned");
    expect(calls.class_assessments.update[0]).not.toHaveProperty("points_source");
  });
});

describe("school.schedule_event.edit_series — 'change the class permanently'", () => {
  it("checks the domain guard, then changes the permanent pattern", async () => {
    const action = getWriteAction("school", "schedule_event", "edit_series")!;
    const { client, calls } = makeClient({ maybeSingleSeq: { schedule_events: [{ domain: "school" }] } });

    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now, id: "event-1" },
      { day_of_week: 4, event_time: "14:00" },
    );

    expect(textOf(outcome)).toEqual({ id: "event-1" });
    expect(calls.schedule_events.update[0]).toMatchObject({ day_of_week: 4, event_time: "14:00" });
  });

  it("REJECTS editing a co_op (work hours) row through the school entity", async () => {
    const action = getWriteAction("school", "schedule_event", "edit_series")!;
    const { client } = makeClient({ maybeSingleSeq: { schedule_events: [{ domain: "co_op" }] } });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "event-1" }, { day_of_week: 4, event_time: "14:00" }),
    ).rejects.toThrow(/domain/i);
  });
});

describe("school.schedule_event.set_override — 'move next Tuesday's class'", () => {
  it("upserts the one-occurrence override without touching the permanent pattern", async () => {
    const action = getWriteAction("school", "schedule_event", "set_override")!;
    const { client, calls } = makeClient({ maybeSingleSeq: { schedule_events: [{ domain: "school" }] } });

    const outcome = await action.handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now, id: "event-1" },
      { date: "2026-09-15", event_time: "15:00" },
    );

    expect(textOf(outcome)).toEqual({ id: "event-1", date: "2026-09-15" });
    expect(calls.schedule_event_overrides.upsert[0]).toMatchObject({ event_id: "event-1", date: "2026-09-15", event_time: "15:00" });
    expect(calls.schedule_events.update).toHaveLength(0); // never touches the permanent row
  });

  it.each([
    ["2026-09-08", "America/Chicago 18:59 local"],
    ["2026-09-09", "America/Chicago 19:01 local"],
    ["2026-09-09", "Asia/Tokyo"],
  ])("passes the occurrence date through byte-for-byte no matter what ctx.now/timezone are (%s, %s)", async (date) => {
    const action = getWriteAction("school", "schedule_event", "set_override")!;
    const { client, calls } = makeClient({ maybeSingleSeq: { schedule_events: [{ domain: "school" }] } });

    await action.handler({ userClient: client, userId: "user-1", timezone: "Asia/Tokyo", now: new Date("2026-09-08T23:59:00.000Z"), id: "event-1" }, { date, event_time: "15:00" });

    expect(calls.schedule_event_overrides.upsert[0]).toMatchObject({ date });
  });
});

describe("school.schedule_event.cancel_occurrence — 'cancel this one instance'", () => {
  it("records the cancellation without touching the permanent pattern or any override", async () => {
    const action = getWriteAction("school", "schedule_event", "cancel_occurrence")!;
    const { client, calls } = makeClient({ maybeSingleSeq: { schedule_events: [{ domain: "school" }] } });

    const outcome = await action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "event-1" }, { date: "2026-09-15" });

    expect(textOf(outcome)).toEqual({ id: "event-1", date: "2026-09-15" });
    expect(calls.schedule_event_cancellations.upsert[0]).toMatchObject({ event_id: "event-1", date: "2026-09-15" });
    expect(calls.schedule_events.update).toHaveLength(0);
  });

  it("REJECTS cancelling an occurrence of a co_op row through the school entity", async () => {
    const action = getWriteAction("school", "schedule_event", "cancel_occurrence")!;
    const { client } = makeClient({ maybeSingleSeq: { schedule_events: [{ domain: "co_op" }] } });
    await expect(
      action.handler({ userClient: client, userId: "user-1", timezone: "UTC", now, id: "event-1" }, { date: "2026-09-15" }),
    ).rejects.toThrow(/domain/i);
  });
});

// CANVAS-LITE-02's patch.items validation -- every case here throws
// BEFORE ctx.userClient is ever touched (a bad database stub would still
// pass), so a minimal client is enough. The deep business-logic behavior
// (course auto-map, never-overwrite, CANVAS-GAP-03's grading_type guard)
// is covered end-to-end in lib/canvas/__tests__/agent-import-core.test.ts.
describe("school.canvas_import.run_batch — patch.items validation", () => {
  const action = () => getWriteAction("school", "canvas_import", "run_batch")!;
  const ctx = { userClient: {} as never, userId: "user-1", timezone: "UTC", now };

  it("rejects a missing/non-array patch.items", async () => {
    await expect(action().handler(ctx, {})).rejects.toThrow(/patch\.items is required and must be a non-empty array/);
    await expect(action().handler(ctx, { items: "not-an-array" })).rejects.toThrow(/patch\.items is required and must be a non-empty array/);
    await expect(action().handler(ctx, { items: [] })).rejects.toThrow(/patch\.items is required and must be a non-empty array/);
  });

  it("rejects more than 200 items", async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ kind: "announcement", canvas_course_id: "10", canvas_announcement_id: `a${i}`, text: "x" }));
    await expect(action().handler(ctx, { items })).rejects.toThrow(/must contain at most 200 items/);
  });

  it("rejects an unrecognized item kind", async () => {
    await expect(action().handler(ctx, { items: [{ kind: "bogus" }] })).rejects.toThrow(/kind must be one of "course", "assessment", "announcement"/);
  });

  it("rejects an assessment item missing points_earned", async () => {
    await expect(
      action().handler(ctx, { items: [{ kind: "assessment", canvas_course_id: "10", canvas_assignment_id: "assn-1", name: "Essay" }] }),
    ).rejects.toThrow(/points_earned is required and must be a number/);
  });

  it("accepts an assessment item with grading_type omitted (defaults to null, never guessed)", async () => {
    // Reaches the real core (no course mapping exists), which is fine --
    // this test is only proving validation itself doesn't reject the
    // patch for omitting grading_type.
    const { client } = makeClient({});
    const outcome = await action().handler(
      { userClient: client, userId: "user-1", timezone: "UTC", now },
      { items: [{ kind: "assessment", canvas_course_id: "10", canvas_assignment_id: "assn-1", name: "Essay", points_earned: 92 }] },
    );
    expect(textOf(outcome)).toMatchObject({ results: [{ kind: "assessment", ref: "assn-1", outcome: "skipped", reason: "course not mapped to a local class" }] });
  });

  it("rejects a non-string, non-null grading_type", async () => {
    await expect(
      action().handler(ctx, { items: [{ kind: "assessment", canvas_course_id: "10", canvas_assignment_id: "assn-1", name: "Essay", points_earned: 92, grading_type: 5 }] }),
    ).rejects.toThrow(/grading_type must be a string or null/);
  });
});
