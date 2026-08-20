import { describe, expect, it } from "vitest";
import { agendaTasks, groupByStage, blockedTasks, nextStage, previousStage, type CoopTaskRow } from "../tasks";

function task(overrides: Partial<CoopTaskRow> = {}): CoopTaskRow {
  return {
    id: "t1",
    title: "Task",
    deadline: null,
    status: "backlog",
    blockedFrom: null,
    createdAt: "2026-08-20T00:00:00Z",
    ...overrides,
  };
}

describe("agendaTasks", () => {
  it("excludes complete tasks", () => {
    const rows = [task({ id: "a", status: "complete" }), task({ id: "b", status: "backlog" })];
    expect(agendaTasks(rows).map((t) => t.id)).toEqual(["b"]);
  });

  it("keeps blocked tasks — being paused isn't being done", () => {
    const rows = [task({ id: "a", status: "blocked", blockedFrom: "in_progress" })];
    expect(agendaTasks(rows).map((t) => t.id)).toEqual(["a"]);
  });

  it("sorts by deadline ascending, nulls last, then creation order", () => {
    const rows = [
      task({ id: "no-deadline-later", deadline: null, createdAt: "2026-08-20T02:00:00Z" }),
      task({ id: "sep-01", deadline: "2026-09-01" }),
      task({ id: "no-deadline-earlier", deadline: null, createdAt: "2026-08-20T01:00:00Z" }),
      task({ id: "aug-25", deadline: "2026-08-25" }),
    ];
    expect(agendaTasks(rows).map((t) => t.id)).toEqual(["aug-25", "sep-01", "no-deadline-earlier", "no-deadline-later"]);
  });
});

describe("groupByStage", () => {
  it("buckets each non-blocked status into its own column", () => {
    const rows = [
      task({ id: "a", status: "backlog" }),
      task({ id: "b", status: "in_progress" }),
      task({ id: "c", status: "review" }),
      task({ id: "d", status: "complete" }),
    ];
    const groups = groupByStage(rows);
    expect(groups.backlog.map((t) => t.id)).toEqual(["a"]);
    expect(groups.in_progress.map((t) => t.id)).toEqual(["b"]);
    expect(groups.review.map((t) => t.id)).toEqual(["c"]);
    expect(groups.complete.map((t) => t.id)).toEqual(["d"]);
  });

  it("excludes blocked tasks entirely — detached, not folded into their origin column", () => {
    const rows = [task({ id: "a", status: "blocked", blockedFrom: "review" })];
    const groups = groupByStage(rows);
    expect(groups.review).toEqual([]);
    expect(groups.backlog).toEqual([]);
  });
});

describe("blockedTasks", () => {
  it("returns only blocked tasks", () => {
    const rows = [task({ id: "a", status: "blocked" }), task({ id: "b", status: "backlog" })];
    expect(blockedTasks(rows).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("nextStage / previousStage", () => {
  it("advances through the sequence and stops at complete", () => {
    expect(nextStage("backlog")).toBe("in_progress");
    expect(nextStage("in_progress")).toBe("review");
    expect(nextStage("review")).toBe("complete");
    expect(nextStage("complete")).toBeNull();
  });

  it("retreats through the sequence and stops at backlog", () => {
    expect(previousStage("complete")).toBe("review");
    expect(previousStage("backlog")).toBeNull();
  });
});
