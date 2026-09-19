import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClassCore, updateClassCore, addClassAssessmentCore, updateClassAssessmentCore } from "../actions-core";
import { ToolNotFoundError } from "@/lib/mcp/tool-input-error";

function makeChain(resolvedValue: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "update", "insert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => resolvedValue);
  chain.single = vi.fn(async () => resolvedValue);
  chain.then = (resolve: (v: typeof resolvedValue) => void) => resolve(resolvedValue);
  return chain as Record<string, ReturnType<typeof vi.fn>>;
}

describe("createClassCore", () => {
  it("computes position as max(existing)+1 for this user", async () => {
    const classesChain = makeChain({ data: { position: 4 }, error: null });
    classesChain.insert = vi.fn(() => {
      const insertChain = makeChain({ data: { id: "class-new" }, error: null });
      return insertChain;
    });
    const from = vi.fn(() => classesChain);
    const client = { from } as unknown as SupabaseClient;

    const id = await createClassCore(client, "user-1", { code: "CS-3341-HON", shortName: "DSA" });

    expect(from).toHaveBeenCalledWith("classes");
    expect(classesChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", code: "CS-3341-HON", short_name: "DSA", position: 5 })
    );
    expect(id).toBe("class-new");
  });

  it("starts position at 0 when the user has no existing classes (maxRow null)", async () => {
    const classesChain = makeChain({ data: null, error: null });
    classesChain.insert = vi.fn(() => makeChain({ data: { id: "class-new" }, error: null }));
    const from = vi.fn(() => classesChain);
    const client = { from } as unknown as SupabaseClient;

    await createClassCore(client, "user-1", { code: "MATH 2418" });

    expect(classesChain.insert).toHaveBeenCalledWith(expect.objectContaining({ position: 0 }));
  });
});

describe("updateClassCore", () => {
  // P4-34's requireRowUpdated chains .select("id") onto the update and reads
  // its result to detect a zero-row match -- every test in this block that
  // expects a normal, successful edit passes a non-empty row back so that
  // check doesn't fire. The two tests below that DO care about a zero-row
  // result pass `[]` explicitly.
  it("updates short_name/room/instructor, scoped to id and user_id", async () => {
    const chain = makeChain({ data: [{ id: "class-1" }], error: null });
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await updateClassCore(client, "user-1", "class-1", { shortName: "Prob & Stats", room: "ENG 201", instructor: null });

    expect(from).toHaveBeenCalledWith("classes");
    expect(chain.update).toHaveBeenCalledWith({ short_name: "Prob & Stats", room: "ENG 201", instructor: null, term: undefined });
    expect(chain.eq).toHaveBeenCalledWith("id", "class-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  // Migration 152 (Phase 1 #11) adds classes.term. Covered here even though
  // no reader is wired up yet (get-class-cards.ts/class-detail-dialog.tsx
  // deliberately do NOT select/display it pre-apply -- see this engineer's
  // own report: database.types.ts can't know about a column that isn't in
  // the live schema yet, and get-class-cards.ts is checked against it
  // directly). This write path uses the untyped SupabaseClient, so it
  // compiles and is correct today and needs no further code change once
  // migration 152 is applied.
  it("passes term through untouched (undefined when omitted, a real value or null when provided)", async () => {
    const chain = makeChain({ data: [{ id: "class-1" }], error: null });
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await updateClassCore(client, "user-1", "class-1", { term: "Fall 2026" });

    expect(chain.update).toHaveBeenCalledWith({
      short_name: undefined,
      room: undefined,
      instructor: undefined,
      term: "Fall 2026",
    });
  });

  // P4-34: both cases below produce the IDENTICAL zero-row result from the
  // same user_id-scoped query -- account A editing account B's class id is
  // indistinguishable from account A editing an id that never existed.
  it("throws a clean not-found for a cross-tenant id (account A editing account B's class) instead of reporting success", async () => {
    const chain = makeChain({ data: [], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await expect(
      updateClassCore(client, "user-1", "belongs-to-account-b", { shortName: "Renamed" })
    ).rejects.toThrow(/No class found with id "belongs-to-account-b"/);
  });

  it("throws a clean not-found for the caller's own stale/deleted id -- the common, non-adversarial case", async () => {
    const chain = makeChain({ data: [], error: null });
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    await expect(updateClassCore(client, "user-1", "deleted-earlier", { shortName: "Renamed" })).rejects.toThrow(
      /No class found with id "deleted-earlier"/
    );
  });
});

describe("addClassAssessmentCore", () => {
  it("creates the task first, then the assessment pointing at it (ruling R5)", async () => {
    const tasksChain = makeChain({ data: { id: "task-new" }, error: null });
    const assessmentsChain = makeChain({ data: { id: "assessment-new" }, error: null });
    const from = vi.fn((table: string) => (table === "tasks" ? tasksChain : assessmentsChain));
    const client = { from } as unknown as SupabaseClient;

    const result = await addClassAssessmentCore(client, "user-1", "class-1", "Midterm 2", "final_midterm", "2026-10-15");

    expect(tasksChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", domain: "school", title: "Midterm 2", due_date: "2026-10-15", task_type: "final_midterm", class_id: "class-1" })
    );
    expect(assessmentsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", class_id: "class-1", name: "Midterm 2", type: "final_midterm", date: "2026-10-15", task_id: "task-new" })
    );
    expect(result).toEqual({ assessmentId: "assessment-new", taskId: "task-new" });
  });

  it.each([
    ["homework_assignment"],
    ["project_paper"],
  ])("accepts the widened deliverable type %s and mirrors it onto the linked task's task_type (migration 151)", async (type) => {
    const tasksChain = makeChain({ data: { id: "task-new" }, error: null });
    const assessmentsChain = makeChain({ data: { id: "assessment-new" }, error: null });
    const from = vi.fn((table: string) => (table === "tasks" ? tasksChain : assessmentsChain));
    const client = { from } as unknown as SupabaseClient;

    await addClassAssessmentCore(client, "user-1", "class-1", "Lab report", type as "homework_assignment" | "project_paper", "2026-10-15");

    expect(tasksChain.insert).toHaveBeenCalledWith(expect.objectContaining({ task_type: type }));
    expect(assessmentsChain.insert).toHaveBeenCalledWith(expect.objectContaining({ type }));
  });

  it("cleans up the just-created task if the assessment insert fails — never an orphaned task with no assessment", async () => {
    const tasksChain = makeChain({ data: { id: "task-new" }, error: null });
    const assessmentsChain = makeChain({ data: null, error: { message: "boom" } });
    const from = vi.fn((table: string) => (table === "tasks" ? tasksChain : assessmentsChain));
    const client = { from } as unknown as SupabaseClient;

    await expect(addClassAssessmentCore(client, "user-1", "class-1", "x", "quiz", "2026-10-15")).rejects.toThrow();

    expect(tasksChain.delete).toHaveBeenCalledTimes(1);
    expect(tasksChain.eq).toHaveBeenCalledWith("id", "task-new");
  });

  it.each([
    ["2026-09-08", "America/Chicago 18:59"],
    ["2026-09-09", "America/Chicago 19:01"],
    ["2026-09-09", "Asia/Tokyo"],
  ])("passes the date string through byte-for-byte regardless of caller timezone (%s, %s)", async (date) => {
    const tasksChain = makeChain({ data: { id: "task-new" }, error: null });
    const assessmentsChain = makeChain({ data: { id: "assessment-new" }, error: null });
    const from = vi.fn((table: string) => (table === "tasks" ? tasksChain : assessmentsChain));
    const client = { from } as unknown as SupabaseClient;

    await addClassAssessmentCore(client, "user-1", "class-1", "x", "quiz", date);

    expect(tasksChain.insert).toHaveBeenCalledWith(expect.objectContaining({ due_date: date }));
    expect(assessmentsChain.insert).toHaveBeenCalledWith(expect.objectContaining({ date }));
  });
});

describe("updateClassAssessmentCore", () => {
  it("updates the assessment and syncs its linked task's title/due_date/task_type", async () => {
    const assessmentsChain = makeChain({ data: { task_id: "task-1" }, error: null });
    const tasksChain = makeChain();
    const from = vi.fn((table: string) => (table === "class_assessments" ? assessmentsChain : tasksChain));
    const client = { from } as unknown as SupabaseClient;

    await updateClassAssessmentCore(client, "user-1", "assessment-1", { name: "Renamed", type: "exam", date: "2026-10-20" });

    expect(assessmentsChain.update).toHaveBeenCalledWith({ name: "Renamed", type: "exam", date: "2026-10-20" });
    expect(tasksChain.update).toHaveBeenCalledWith({ title: "Renamed", due_date: "2026-10-20", task_type: "exam" });
    expect(tasksChain.eq).toHaveBeenCalledWith("id", "task-1");
  });

  it("never syncs a task when the assessment has none (task_id null)", async () => {
    const assessmentsChain = makeChain({ data: { task_id: null }, error: null });
    const tasksChain = makeChain();
    const from = vi.fn((table: string) => (table === "class_assessments" ? assessmentsChain : tasksChain));
    const client = { from } as unknown as SupabaseClient;

    await updateClassAssessmentCore(client, "user-1", "assessment-1", { name: "x", type: "quiz", date: "2026-10-20" });

    expect(tasksChain.update).not.toHaveBeenCalled();
  });

  it("sets weight_pct only when explicitly provided (undefined leaves it untouched, null clears it)", async () => {
    const assessmentsChain = makeChain({ data: { task_id: null }, error: null });
    const from = vi.fn(() => assessmentsChain);
    const client = { from } as unknown as SupabaseClient;

    await updateClassAssessmentCore(client, "user-1", "assessment-1", { name: "x", type: "quiz", date: "2026-10-20" });
    expect(assessmentsChain.update).toHaveBeenCalledWith({ name: "x", type: "quiz", date: "2026-10-20" });

    await updateClassAssessmentCore(client, "user-1", "assessment-1", { name: "x", type: "quiz", date: "2026-10-20", weightPct: null });
    expect(assessmentsChain.update).toHaveBeenCalledWith({ name: "x", type: "quiz", date: "2026-10-20", weight_pct: null });
  });

  /**
   * P2-21 (Opus Lead's never-overwrite-a-user-grade ruling): providing
   * pointsEarned here is THE user-edit path migration 189's points_source
   * invariant is about -- it must ALWAYS clear points_source back to null,
   * so a user's correction to a Canvas-synced grade is never silently
   * re-overwritten by the next sync (lib/canvas/sync-core.ts only ever
   * writes points_earned when points_source is null-or-already-'canvas',
   * so clearing it here is what makes a manual correction stick).
   */
  it("providing pointsEarned always clears points_source, marking the grade user-entered again", async () => {
    const assessmentsChain = makeChain({ data: { task_id: null }, error: null });
    const from = vi.fn(() => assessmentsChain);
    const client = { from } as unknown as SupabaseClient;

    await updateClassAssessmentCore(client, "user-1", "assessment-1", { name: "x", type: "quiz", date: "2026-10-20", pointsEarned: 87 });
    expect(assessmentsChain.update).toHaveBeenCalledWith({ name: "x", type: "quiz", date: "2026-10-20", points_earned: 87, points_source: null });
  });

  it("omitting pointsEarned leaves both points_earned and points_source untouched", async () => {
    const assessmentsChain = makeChain({ data: { task_id: null }, error: null });
    const from = vi.fn(() => assessmentsChain);
    const client = { from } as unknown as SupabaseClient;

    await updateClassAssessmentCore(client, "user-1", "assessment-1", { name: "x", type: "quiz", date: "2026-10-20" });
    const call = assessmentsChain.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("points_earned");
    expect(call).not.toHaveProperty("points_source");
  });

  // GAP-01: points_possible is a real column Canvas sync also writes
  // alongside points_earned, under the SAME never-overwrite guard
  // (lib/canvas/sync-core.ts:265) -- a hand-edit to either must equally
  // protect against a later sync overwriting it.
  it("providing pointsPossible ALONE also clears points_source -- Canvas treats earned+possible as one unit, so a hand-edit must too", async () => {
    const assessmentsChain = makeChain({ data: { task_id: null }, error: null });
    const from = vi.fn(() => assessmentsChain);
    const client = { from } as unknown as SupabaseClient;

    await updateClassAssessmentCore(client, "user-1", "assessment-1", { name: "x", type: "quiz", date: "2026-10-20", pointsPossible: 100 });

    expect(assessmentsChain.update).toHaveBeenCalledWith({ name: "x", type: "quiz", date: "2026-10-20", points_possible: 100, points_source: null });
  });

  it("providing BOTH pointsEarned and pointsPossible writes both columns and clears points_source once", async () => {
    const assessmentsChain = makeChain({ data: { task_id: null }, error: null });
    const from = vi.fn(() => assessmentsChain);
    const client = { from } as unknown as SupabaseClient;

    await updateClassAssessmentCore(client, "user-1", "assessment-1", {
      name: "x",
      type: "quiz",
      date: "2026-10-20",
      pointsEarned: 87,
      pointsPossible: 100,
    });

    expect(assessmentsChain.update).toHaveBeenCalledWith({
      name: "x",
      type: "quiz",
      date: "2026-10-20",
      points_earned: 87,
      points_possible: 100,
      points_source: null,
    });
  });

  it("omitting pointsPossible leaves it untouched (same convention as pointsEarned)", async () => {
    const assessmentsChain = makeChain({ data: { task_id: null }, error: null });
    const from = vi.fn(() => assessmentsChain);
    const client = { from } as unknown as SupabaseClient;

    await updateClassAssessmentCore(client, "user-1", "assessment-1", { name: "x", type: "quiz", date: "2026-10-20" });
    const call = assessmentsChain.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("points_possible");
  });

  // P4-34 message-shape normalization (Category F, ENG-A's triage) -- this
  // was NEVER a false-success bug: the pre-read below already uses
  // .single(), which throws for a zero-row result, so a bad/cross-tenant
  // top-level id already fails closed. The defect is only in the SHAPE of
  // that failure -- a raw, untranslated PostgREST error (code PGRST116)
  // instead of the same clean ToolNotFoundError every other not-found case
  // in this registry uses, which an AI caller can't self-correct from the
  // same way. Both a cross-tenant id and the caller's own stale id hit the
  // SAME .single() call, scoped by user_id, so they produce the identical
  // translated error either way.
  it("throws a clean ToolNotFoundError, not a raw PostgREST error, for a cross-tenant id (account A editing account B's assessment)", async () => {
    const assessmentsChain = makeChain({ data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } });
    const client = { from: vi.fn(() => assessmentsChain) } as unknown as SupabaseClient;

    await expect(
      updateClassAssessmentCore(client, "user-1", "belongs-to-account-b", { name: "x", type: "quiz", date: "2026-10-20" })
    ).rejects.toThrow(ToolNotFoundError);
    await expect(
      updateClassAssessmentCore(client, "user-1", "belongs-to-account-b", { name: "x", type: "quiz", date: "2026-10-20" })
    ).rejects.toThrow(/No class assessment found with id "belongs-to-account-b"/);
  });

  it("throws a clean ToolNotFoundError for the caller's own stale/deleted id -- the common, non-adversarial case", async () => {
    const assessmentsChain = makeChain({ data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } });
    const client = { from: vi.fn(() => assessmentsChain) } as unknown as SupabaseClient;

    await expect(
      updateClassAssessmentCore(client, "user-1", "deleted-earlier", { name: "x", type: "quiz", date: "2026-10-20" })
    ).rejects.toThrow(/No class assessment found with id "deleted-earlier"/);
  });

  it("still propagates a genuinely different fetch error raw -- only the zero-row (PGRST116) shape gets translated", async () => {
    const assessmentsChain = makeChain({ data: null, error: { code: "08006", message: "connection reset" } });
    const client = { from: vi.fn(() => assessmentsChain) } as unknown as SupabaseClient;

    await expect(
      updateClassAssessmentCore(client, "user-1", "assessment-1", { name: "x", type: "quiz", date: "2026-10-20" })
    ).rejects.toThrow("connection reset");
  });
});
