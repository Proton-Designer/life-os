import { beforeEach, describe, expect, it, vi } from "vitest";

const dump = vi.fn();
const apply = vi.fn();
const addTask = vi.fn(async (..._a: unknown[]) => {});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/night-plan/plan-actions-core", () => ({ dumpLineCore: (...a: unknown[]) => dump(...a) }));
vi.mock("@/lib/night-plan/plan-details-core", () => ({ applyPlanDetailsCore: (...a: unknown[]) => apply(...a) }));
vi.mock("@/lib/tasks/actions-core", () => ({ addTaskCore: (...a: unknown[]) => addTask(...a) }));

import { captureAreaTaskCore } from "../capture-task-core";

const deleted: unknown[] = [];
const supabase = {
  from: (table: string) => ({
    delete: () => ({
      eq: (c: string, v: unknown) => ({
        eq: (c2: string, v2: unknown) => {
          deleted.push([table, c, v, c2, v2]);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
} as never;
const DAY = "2026-10-20";
const run = (input: Parameters<typeof captureAreaTaskCore>[3], killListAvailable = true) => captureAreaTaskCore(supabase, "u1", DAY, input, { killListAvailable });
const appliedLine = () => (apply.mock.calls[0]![3] as Record<string, unknown>[])[0]!;

beforeEach(() => {
  dump.mockReset().mockResolvedValue({ id: "t1" });
  apply.mockReset().mockResolvedValue({ killListOverflow: [], notices: [] });
  addTask.mockClear();
  deleted.length = 0;
});

describe("captureAreaTaskCore: an undated or today task becomes a plan line in its area", () => {
  it("School: a line on the plan day, attached to School (the same Edit Plan save path makes it a School task)", async () => {
    const res = await run({ title: "Lin Alg ch 4", area: "school" });
    expect(dump).toHaveBeenCalledWith(supabase, "u1", DAY, "Lin Alg ch 4");
    expect(appliedLine()).toMatchObject({ id: "t1", area: "school", addToKillList: false, startTime: null });
    expect(apply.mock.calls[0]![2]).toBe(DAY);
    expect(addTask).not.toHaveBeenCalled();
    expect(res).toMatchObject({ kind: "planned", id: "t1" });
  });
  it("Work goes through the plan's Work area (the Backlog / weekly pipeline entry)", async () => {
    await run({ title: "Send weekly update", area: "co_op" });
    expect(appliedLine()).toMatchObject({ area: "work", addToKillList: false });
  });
  it("Business asks for the Kill List and passes whether the account has one", async () => {
    await run({ title: "Close the deal", area: "business" });
    expect(appliedLine()).toMatchObject({ area: "business", addToKillList: true });
    expect(apply.mock.calls[0]![4]).toEqual({ killListAvailable: true });
    apply.mockClear();
    await run({ title: "x", area: "business" }, false);
    expect(apply.mock.calls[0]![4]).toEqual({ killListAvailable: false });
  });
  it("a spoken time becomes the line's start time; a date equal to the plan day still plans it", async () => {
    await run({ title: "Call Sam", area: "school", dueDate: DAY, dueTime: "17:00" });
    expect(appliedLine()).toMatchObject({ startTime: "17:00" });
    expect(dump).toHaveBeenCalledTimes(1);
  });
  it("passes notices and an overflowing Kill List back so the caller can say so", async () => {
    apply.mockResolvedValue({ killListOverflow: ["Close the deal"], notices: ["no target"] });
    expect(await run({ title: "Close the deal", area: "business" })).toMatchObject({ notices: ["no target"], killListOverflow: ["Close the deal"] });
  });
});

describe("captureAreaTaskCore: another day keeps its own date", () => {
  it("a dated School or Work task is a plain dated task and is not put on today's plan (positive control: no dump line)", async () => {
    const res = await run({ title: "Hand in essay", area: "school", dueDate: "2026-10-25", dueTime: "09:00" });
    expect(res).toEqual({ kind: "dated" });
    expect(addTask).toHaveBeenCalledWith(supabase, "u1", { domain: "school", title: "Hand in essay", dueDate: "2026-10-25", dueTime: "09:00" });
    expect(dump).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
  it("a dated Business task is handed back for the Inbox (the Kill List cannot hold a date)", async () => {
    expect(await run({ title: "Pitch", area: "business", dueDate: "2026-10-25" })).toEqual({ kind: "inbox-dated" });
    expect(dump).not.toHaveBeenCalled();
  });
});

describe("captureAreaTaskCore: failures leave nothing half-made", () => {
  it("when the area step fails the new plan line is deleted and the error is thrown", async () => {
    apply.mockResolvedValue({ error: "the Kill List didn't update" });
    await expect(run({ title: "Close the deal", area: "business" })).rejects.toThrow(/Kill List/);
    expect(deleted).toEqual([["tasks", "id", "t1", "user_id", "u1"]]);
  });
  it("when the line can't be made nothing else runs", async () => {
    dump.mockResolvedValue({ error: "boom" });
    await expect(run({ title: "x", area: "school" })).rejects.toThrow("boom");
    expect(apply).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });
});
