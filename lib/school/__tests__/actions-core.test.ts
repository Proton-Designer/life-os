import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClassCore, updateClassCore, addClassAssessmentCore, updateClassAssessmentCore } from "../actions-core";

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
  it("updates short_name/room/instructor, scoped to id and user_id", async () => {
    const chain = makeChain();
    const from = vi.fn(() => chain);
    const client = { from } as unknown as SupabaseClient;

    await updateClassCore(client, "user-1", "class-1", { shortName: "Prob & Stats", room: "ENG 201", instructor: null });

    expect(from).toHaveBeenCalledWith("classes");
    expect(chain.update).toHaveBeenCalledWith({ short_name: "Prob & Stats", room: "ENG 201", instructor: null });
    expect(chain.eq).toHaveBeenCalledWith("id", "class-1");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("addClassAssessmentCore", () => {
  it("creates the task first, then the assessment pointing at it (ruling R5)", async () => {
    const tasksChain = makeChain({ data: { id: "task-new" }, error: null });
    const assessmentsChain = makeChain({ data: { id: "assessment-new" }, error: null });
    const from = vi.fn((table: string) => (table === "tasks" ? tasksChain : assessmentsChain));
    const client = { from } as unknown as SupabaseClient;

    const result = await addClassAssessmentCore(client, "user-1", "class-1", "Midterm 2", "midterm_final", "2026-10-15");

    expect(tasksChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", domain: "school", title: "Midterm 2", due_date: "2026-10-15", task_type: "final_midterm", class_id: "class-1" })
    );
    expect(assessmentsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", class_id: "class-1", name: "Midterm 2", type: "midterm_final", date: "2026-10-15", task_id: "task-new" })
    );
    expect(result).toEqual({ assessmentId: "assessment-new", taskId: "task-new" });
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
});
