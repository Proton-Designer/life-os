import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeTaskCore, updateTaskCore } from "../actions-core";

type Op = [string, ...unknown[]];
/** A fake client that records every operation per table and answers .maybeSingle() from `linked`. */
function fake(linked: { id: string } | null) {
  const ops: Record<string, Op[]> = {};
  const order: string[] = [];
  const from = vi.fn((table: string) => {
    const rec = (ops[table] ??= []);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "update", "delete", "eq"]) {
      chain[m] = vi.fn((...a: unknown[]) => {
        rec.push([m, ...a]);
        if (m === "update" || m === "delete") order.push(`${table}.${m}`);
        return chain;
      });
    }
    chain.maybeSingle = vi.fn(async () => ({ data: table === "class_assessments" ? linked : null, error: null }));
    chain.then = (res: (v: { data: null; error: null }) => void) => res({ data: null, error: null });
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, ops, order };
}
const updates = (ops: Record<string, Op[]>, table: string) => (ops[table] ?? []).filter((o) => o[0] === "update").map((o) => o[1]);

describe("task -> assessment sync (SCHOOL-01 G1)", () => {
  it("editing the PAIRED task pushes name, date and an assessable type to its assessment", async () => {
    const { client, ops } = fake({ id: "a1" });
    await updateTaskCore(client, "u1", "t1", { title: "Midterm 1", dueDate: "2026-10-20", taskType: "exam" });
    expect(updates(ops, "class_assessments")).toEqual([{ name: "Midterm 1", date: "2026-10-20", type: "exam" }]);
    expect((ops["class_assessments"] ?? []).filter((o) => o[0] === "eq")).toContainEqual(["eq", "task_id", "t1"]);
    expect((ops["class_assessments"] ?? []).filter((o) => o[0] === "eq")).toContainEqual(["eq", "user_id", "u1"]);
  });
  it("a legacy final_midterm edit lands as exam on both rows", async () => {
    const { client, ops } = fake({ id: "a1" });
    await updateTaskCore(client, "u1", "t1", { title: "Final", dueDate: "2026-12-01", taskType: "final_midterm" });
    expect(updates(ops, "tasks")[0]).toMatchObject({ task_type: "exam" });
    expect(updates(ops, "class_assessments")[0]).toMatchObject({ type: "exam" });
  });
  it("an emptied date never blanks the assessment's NOT NULL date; a non-assessable type leaves its type alone", async () => {
    const { client, ops } = fake({ id: "a1" });
    await updateTaskCore(client, "u1", "t1", { title: "Read ch. 3", taskType: "reading_review" });
    expect(updates(ops, "class_assessments")).toEqual([{ name: "Read ch. 3" }]);
  });
  it("positive control: a task with NO assessment never touches class_assessments", async () => {
    const { client, ops } = fake(null);
    await updateTaskCore(client, "u1", "t9", { title: "Buy a calculator", dueDate: "2026-10-20", taskType: "reminder" });
    expect(updates(ops, "class_assessments")).toEqual([]);
    expect(updates(ops, "tasks")).toHaveLength(1);
  });
  it("removing the PAIRED task removes its assessment too (task first, then the assessment)", async () => {
    const { client, ops, order } = fake({ id: "a1" });
    await removeTaskCore(client, "u1", "t1");
    expect(order).toEqual(["tasks.delete", "class_assessments.delete"]);
    expect((ops["class_assessments"] ?? []).filter((o) => o[0] === "eq")).toContainEqual(["eq", "id", "a1"]);
  });
  it("removing an unpaired task deletes only the task", async () => {
    const { client, order } = fake(null);
    await removeTaskCore(client, "u1", "t9");
    expect(order).toEqual(["tasks.delete"]);
  });
});
