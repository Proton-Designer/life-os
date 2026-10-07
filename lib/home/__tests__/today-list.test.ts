import { describe, expect, it } from "vitest";
import { buildTodayList, pickFocusId } from "../today-list";
import type { PriorityItem } from "../types";
import type { PlanItem } from "@/lib/plan/get-plan-items";

const NOW = new Date("2026-10-07T15:00:00.000Z");

function plan(over: Partial<PlanItem> & Pick<PlanItem, "id">): PlanItem {
  return { title: over.id, area: null, startTime: null, durationMinutes: null, timerStartedAt: null, timerElapsedSeconds: 0, completed: false, mitRank: null, planOrder: null, killListItemId: null, classId: null, createdAt: "2026-10-06T20:00:00Z", ...over };
}
function prio(over: Partial<PriorityItem> & Pick<PriorityItem, "id">): PriorityItem {
  return { domain: "school", title: over.id, dueAt: null, windowEndAt: null, date: "2026-10-07", urgencyBucket: "later_today", completed: false, actionType: "toggle_task", actionRefId: over.id.replace(/^task-/, ""), cost: null, ...over };
}
const list = (planItems: PlanItem[], priorityItems: PriorityItem[], deenMode = true) => buildTodayList({ planItems, priorityItems, weights: {}, now: NOW, deenMode });
const ids = (l: ReturnType<typeof list>) => l.rows.map((r) => r.id);

describe("buildTodayList", () => {
  it("orders: crown, then the other starred lines by rank, then the rest of the plan in plan order, then priority items", () => {
    const l = list(
      [
        plan({ id: "rest-late", startTime: "15:00" }),
        plan({ id: "star3", mitRank: 3 }),
        plan({ id: "crown", mitRank: 1, startTime: "20:00" }), // clock order must not demote the crown
        plan({ id: "rest-early", startTime: "09:00" }),
        plan({ id: "star2", mitRank: 2 }),
      ],
      [prio({ id: "task-p1" })],
    );
    expect(ids(l)).toEqual(["crown", "star2", "star3", "rest-early", "rest-late", "task-p1"]);
    expect(l.rows.map((r) => r.source)).toEqual(["plan", "plan", "plan", "plan", "plan", "priority"]);
  });

  it("shows ALL of a domain's priority items, ranked across domains (the old Now module kept one per domain)", () => {
    const l = list([], [
      prio({ id: "task-a", domain: "school", urgencyBucket: "later_today" }),
      prio({ id: "task-b", domain: "school", urgencyBucket: "later_today" }),
      prio({ id: "task-urgent", domain: "co_op", urgencyBucket: "right_now", dueAt: new Date("2026-10-07T15:10:00.000Z") }),
    ]);
    expect(ids(l)).toHaveLength(3);
    expect(ids(l)).toContain("task-a");
    expect(ids(l)).toContain("task-b");
    expect(ids(l)[0]).toBe("task-urgent"); // the arbiter ranks the soonest-due first
  });

  it("never includes a prayer (they live in the Right now strip), and the fitness link row stays in its ranked place", () => {
    const l = list([], [
      prio({ id: "prayer-dhuhr", domain: "deen", actionType: "toggle_prayer", actionRefId: "dhuhr" }),
      prio({ id: "fitness-today", domain: "fitness", actionType: "open_fitness", actionRefId: "micro" }),
      prio({ id: "task-x" }),
    ]);
    expect(ids(l)).not.toContain("prayer-dhuhr");
    expect(ids(l)).toContain("fitness-today");
    expect(ids(l)).toHaveLength(2);
  });

  it("dedups: a priority task that IS a plan line shows once, as the plan row", () => {
    const l = list([plan({ id: "uuid-1", title: "Finish the HW", area: "school", durationMinutes: 60 })], [prio({ id: "task-uuid-1", actionRefId: "uuid-1" }), prio({ id: "task-other" })]);
    expect(ids(l)).toEqual(["uuid-1", "task-other"]);
    expect(l.rows[0]!.source).toBe("plan");
  });

  it("dedups: a Kill List line mirrored into the plan shows once, as the plan row", () => {
    const l = list([plan({ id: "uuid-2", killListItemId: "kl-9", area: "business", mitRank: 1 })], [prio({ id: "kill-list", domain: "business", actionType: "toggle_kill_list", actionRefId: "kl-9" }), prio({ id: "kill-list-kl-10", domain: "business", actionType: "toggle_kill_list", actionRefId: "kl-10" })]);
    expect(ids(l)).toEqual(["uuid-2", "kill-list-kl-10"]); // only the PAIRED Kill List line is dropped
    // a Kill List row's id is per LINE, never the shared constant "kill-list" (completing A must not hide B arriving under the same id)
    const first = list([], [prio({ id: "kill-list", domain: "business", actionType: "toggle_kill_list", actionRefId: "kl-1" })]);
    expect(ids(first)).toEqual(["kill-list-kl-1"]);
  });

  it("focus: the row with a running timer, else the first pending row, else null", () => {
    const base = [plan({ id: "a", mitRank: 1 }), plan({ id: "b" }), plan({ id: "c" })];
    expect(list(base, []).focusIndex).toBe(0);
    const running = [plan({ id: "a", mitRank: 1 }), plan({ id: "b" }), plan({ id: "c", timerStartedAt: "2026-10-07T14:50:00.000Z" })];
    const l = list(running, []);
    expect(ids(l)[l.focusIndex!]).toBe("c");
    expect(list([], []).focusIndex).toBeNull();
    // a Deep Session working on a plan line makes THAT row "running" for the focus (Package E), even when it is not first
    const withSession = buildTodayList({ planItems: [plan({ id: "a", mitRank: 1 }), plan({ id: "b" }), plan({ id: "c" })], priorityItems: [], weights: {}, now: NOW, deenMode: true, activeSessionTaskId: "c" });
    expect(withSession.rows[withSession.focusIndex!]!.id).toBe("c");
    // ...and a session on a line that is not in the list changes nothing
    const unrelated = buildTodayList({ planItems: [plan({ id: "a", mitRank: 1 }), plan({ id: "b" })], priorityItems: [], weights: {}, now: NOW, deenMode: true, activeSessionTaskId: "zzz" });
    expect(unrelated.rows[unrelated.focusIndex!]!.id).toBe("a");
    // a COMPLETED line with a stale timer is not "running"
    expect(list([plan({ id: "a" }), plan({ id: "z", completed: true, timerStartedAt: "2026-10-07T14:00:00.000Z" })], []).focusIndex).toBe(0);
  });

  it("done plan lines come back separately (for the Completed disclosure), not in the pending rows", () => {
    const l = list([plan({ id: "done", completed: true }), plan({ id: "todo" })], []);
    expect(ids(l)).toEqual(["todo"]);
    expect(l.completedPlan.map((p) => p.id)).toEqual(["done"]);
  });

  it("Deen mode OFF drops any Deen item defensively; ON keeps nothing prayer-like either way", () => {
    const deenTask = prio({ id: "task-d", domain: "deen" });
    expect(ids(list([], [deenTask], false))).toEqual([]);
    expect(ids(list([], [deenTask], true))).toEqual(["task-d"]);
  });
});

describe("pickFocusId", () => {
  const rows = [{ id: "a", running: false }, { id: "b", running: false }, { id: "c", running: true }];
  it("the running row wins, else the first", () => {
    expect(pickFocusId(rows)).toBe("c");
    expect(pickFocusId(rows.map((r) => ({ ...r, running: false })))).toBe("a");
    expect(pickFocusId([])).toBeNull();
  });
  it("a row that is leaving never takes the focus: it moves on to the next row", () => {
    expect(pickFocusId(rows.map((r) => ({ ...r, running: false })), new Set(["a"]))).toBe("b");
    expect(pickFocusId(rows, new Set(["c"]))).toBe("a");
  });
});
