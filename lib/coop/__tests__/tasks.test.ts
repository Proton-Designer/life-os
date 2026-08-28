import { describe, expect, it } from "vitest";
import {
  agendaTasks,
  groupByStage,
  blockedTasks,
  nextStage,
  previousStage,
  isPastCompletedTask,
  splitByPastComplete,
  type CoopTaskRow,
} from "../tasks";

function task(overrides: Partial<CoopTaskRow> = {}): CoopTaskRow {
  return {
    id: "t1",
    title: "Task",
    deadline: null,
    status: "backlog",
    blockedFrom: null,
    createdAt: "2026-08-20T00:00:00Z",
    completedAt: null,
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

describe("isPastCompletedTask", () => {
  const CHICAGO = "America/Chicago";
  // Local Chicago calendar date is Aug 1 for this instant (04:30 UTC = 23:30
  // CDT the previous day).
  const COMPLETED_AT = "2026-08-02T04:30:00.000Z";

  it("is not past a day before the 7-day threshold", () => {
    const now = new Date("2026-08-07T12:00:00.000Z"); // Aug 7 local — 6 days
    expect(isPastCompletedTask(COMPLETED_AT, now, CHICAGO)).toBe(false);
  });

  it("is past exactly at the 7-day threshold", () => {
    const now = new Date("2026-08-08T12:00:00.000Z"); // Aug 8 local — 7 days
    expect(isPastCompletedTask(COMPLETED_AT, now, CHICAGO)).toBe(true);
  });

  // AGENTS.md: "the same local time either side of the UTC rollover (e.g.
  // 18:59 and 19:01 CDT) must produce identical results." A naive
  // getUTCDate()-based diff would read 6 days at 18:59 CDT (UTC still Aug 8)
  // and 7 days two minutes later at 19:01 CDT (UTC has rolled to Aug 9) —
  // flipping past/not-past on a two-minute gap with no real day having
  // elapsed. Both must agree here.
  it("gives the same answer either side of the UTC midnight rollover", () => {
    const before = new Date("2026-08-08T23:59:00.000Z"); // 18:59 CDT, Aug 8 local
    const after = new Date("2026-08-09T00:01:00.000Z"); // 19:01 CDT, still Aug 8 local
    expect(isPastCompletedTask(COMPLETED_AT, before, CHICAGO)).toBe(true);
    expect(isPastCompletedTask(COMPLETED_AT, after, CHICAGO)).toBe(true);
  });

  // A timezone EAST of UTC, where the bug inverts: a raw UTC-date diff
  // would OVER-count here (completedAt's UTC date is already a day behind
  // its Kolkata local date), making a task look past a day early.
  it("does not over-count a day early in a timezone ahead of UTC", () => {
    const KOLKATA = "Asia/Kolkata";
    // 2026-08-01T20:00:00Z is Aug 2, 01:30 local in Kolkata (UTC+5:30).
    const completedAt = "2026-08-01T20:00:00.000Z";
    // 2026-08-08T10:00:00Z is Aug 8, 15:30 local in Kolkata — 6 local days
    // since Aug 2, not yet past — but a raw UTC-date diff (Aug1 -> Aug8)
    // would read 7 and wrongly call it past.
    const now = new Date("2026-08-08T10:00:00.000Z");
    expect(isPastCompletedTask(completedAt, now, KOLKATA)).toBe(false);
  });
});

describe("splitByPastComplete", () => {
  const CHICAGO = "America/Chicago";
  const now = new Date("2026-08-15T12:00:00.000Z");

  it("moves only complete tasks past the threshold into pastTasks", () => {
    const rows = [
      task({ id: "recent", status: "complete", completedAt: "2026-08-14T12:00:00.000Z" }),
      task({ id: "old", status: "complete", completedAt: "2026-08-01T12:00:00.000Z" }),
      task({ id: "active", status: "in_progress" }),
      task({ id: "blocked-old", status: "blocked", blockedFrom: "complete", completedAt: null }),
    ];
    const { pipelineTasks, pastTasks } = splitByPastComplete(rows, now, CHICAGO);
    expect(pastTasks.map((t) => t.id)).toEqual(["old"]);
    expect(pipelineTasks.map((t) => t.id)).toEqual(["recent", "active", "blocked-old"]);
  });
});
