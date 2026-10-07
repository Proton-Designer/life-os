import type { AreaWeightLookup } from "./build-candidates";
import { buildCandidatesFromPriorityItems } from "./build-candidates";
import { rankCandidates } from "./arbiter";
import type { PriorityItem } from "./types";
import { orderPlanItems } from "@/lib/plan/plan-behavior";
import type { PlanItem } from "@/lib/plan/get-plan-items";

/**
 * Home's "Today" list: EVERY task for today in one ordered list, with one row in focus. Pure (no React, no Supabase, no
 * raw Date arithmetic): the Panel hands in the two server reads it already has.
 *
 * Order: 1) the crowned plan line (mitRank 1), 2) the other starred lines (mitRank 2, 3), 3) the rest of the plan in
 * `orderPlanItems` order, 4) the remaining priority items, ranked ACROSS ALL of them by the real arbiter (not one per
 * domain, which is what the old Now module showed).
 *
 * What counts as "today" for a priority item: every item `getPriorityItems` returns, because that function only reads
 * today's rows by construction -- tasks with `due_date == local today`, today's first incomplete Kill List line, today's
 * fitness row, today's prayers. There is no overdue read and nothing due after today to exclude here.
 *
 * Prayers (`toggle_prayer`) never appear: they live in the "Right now" strip.
 *
 * Duplicates: a plan line is a `tasks` row, and the same row/line can also surface as a priority item. The data layer
 * already hides the common paths (getTasks skips any task with `plan_area` set; getKillListItems drops a Kill List row
 * owned by a task planned for today). This function repeats the two id links as a guard, because showing one thing twice
 * (once with Start, once without) is worse than a redundant filter:
 *   - a `toggle_task` priority item whose actionRefId is a plan line's id          -> the plan row wins (it has Start / timer);
 *   - a `toggle_kill_list` priority item whose actionRefId is a plan line's `killListItemId` -> the plan row wins.
 */

export type TodayRow = { source: "plan"; id: string; plan: PlanItem } | { source: "priority"; id: string; priority: PriorityItem };

export type TodayList = {
  /** Pending rows in display order. */
  rows: TodayRow[];
  /** Plan lines already done today (shown struck, below, with Undo). */
  completedPlan: PlanItem[];
  /** Index into `rows` of the row to highlight: the one RUNNING (inline timer started) if any, else the first pending row; null when nothing is pending. */
  focusIndex: number | null;
};

const isStarred = (p: PlanItem) => p.mitRank !== null && p.mitRank >= 1 && p.mitRank <= 3;

export function buildTodayList({
  planItems,
  priorityItems,
  weights,
  now,
  deenMode,
}: {
  planItems: PlanItem[];
  priorityItems: PriorityItem[];
  weights: AreaWeightLookup;
  now: Date;
  deenMode: boolean;
}): TodayList {
  const pendingPlan = planItems.filter((p) => !p.completed);
  const completedPlan = planItems.filter((p) => p.completed);

  const crown = orderPlanItems(pendingPlan.filter((p) => p.mitRank === 1));
  const starred = orderPlanItems(pendingPlan.filter((p) => p.mitRank !== 1 && isStarred(p))).sort((a, b) => (a.mitRank ?? 99) - (b.mitRank ?? 99));
  const rest = orderPlanItems(pendingPlan.filter((p) => !isStarred(p)));

  const planIds = new Set(planItems.map((p) => p.id));
  const planKillListIds = new Set(planItems.map((p) => p.killListItemId).filter((id): id is string => id !== null));
  const wanted = priorityItems.filter((i) => {
    if (i.actionType === "toggle_prayer") return false; // the strip
    if (!deenMode && i.domain === "deen") return false;
    if (i.completed) return false;
    if (i.actionType === "toggle_task" && planIds.has(i.actionRefId)) return false;
    if (i.actionType === "toggle_kill_list" && planKillListIds.has(i.actionRefId)) return false;
    return true;
  });
  const byId = new Map(wanted.map((i) => [i.id, i]));
  const rankedPriority = rankCandidates(buildCandidatesFromPriorityItems(wanted, weights), now).map((c) => byId.get(c.id)!);

  const rows: TodayRow[] = [
    ...[...crown, ...starred, ...rest].map((plan): TodayRow => ({ source: "plan", id: plan.id, plan })),
    ...rankedPriority.map((priority): TodayRow => ({ source: "priority", id: priority.id, priority })),
  ];

  const running = rows.findIndex((r) => r.source === "plan" && r.plan.timerStartedAt !== null);
  const focusIndex = rows.length === 0 ? null : running >= 0 ? running : 0;
  return { rows, completedPlan, focusIndex };
}
